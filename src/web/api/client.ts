import ky, { HTTPError } from "ky"
import { z } from "zod"
import {
  type InitAdminRequest,
  InitAdminRequestSchema,
  type LoginRequest,
  LoginRequestSchema,
  type UserResponse,
  UserResponseSchema,
} from "../../shared/schemas/auth"
import { type BrowseResponse, BrowseResponseSchema } from "../../shared/schemas/browse"
import {
  type InterconnectivityResponse,
  InterconnectivityResponseSchema,
} from "../../shared/schemas/connectivity"
import {
  type AuthTestResponse,
  AuthTestResponseSchema,
  type CreateNodeRequest,
  CreateNodeRequestSchema,
  type NodeProbeResponse,
  NodeProbeResponseSchema,
  type NodeResponse,
  NodeResponseSchema,
  type UpdateNodeRequest,
  UpdateNodeRequestSchema,
} from "../../shared/schemas/nodes"
import {
  type CreateShareRequest,
  CreateShareRequestSchema,
  type HealthCheckResponse,
  HealthCheckResponseSchema,
  type PlanResponse,
  PlanResponseSchema,
  type ShareAccessMode,
  type ShareResponse,
  ShareResponseSchema,
  type UpdateShareRequest,
  UpdateShareRequestSchema,
} from "../../shared/schemas/shares"

const AuthStatusSchema = z.object({ initialized: z.boolean() })
const UserEnvelopeSchema = z.object({ user: UserResponseSchema })
const NodeListEnvelopeSchema = z.object({ nodes: z.array(NodeResponseSchema) })
const ShareListEnvelopeSchema = z.object({ shares: z.array(ShareResponseSchema) })

const api = ky.create({
  prefix: `${window.location.origin}/api`,
  credentials: "include",
  timeout: 30_000,
})

export type AuthStatus = z.infer<typeof AuthStatusSchema>

export async function getAuthStatus(): Promise<AuthStatus> {
  return AuthStatusSchema.parse(await api.get("auth/status").json())
}

export async function getCurrentUser(): Promise<UserResponse | null> {
  try {
    const response = UserEnvelopeSchema.parse(await api.get("auth/me").json())
    return response.user
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 401) {
      return null
    }
    throw error
  }
}

export async function initializeAdmin(input: InitAdminRequest): Promise<UserResponse> {
  const parsed = InitAdminRequestSchema.parse(input)
  const response = UserEnvelopeSchema.parse(await api.post("auth/init", { json: parsed }).json())
  return response.user
}

export async function login(input: LoginRequest): Promise<UserResponse> {
  const parsed = LoginRequestSchema.parse(input)
  const response = UserEnvelopeSchema.parse(await api.post("auth/login", { json: parsed }).json())
  return response.user
}

export async function logout(): Promise<void> {
  await api.post("auth/logout")
}

export async function listNodes(): Promise<readonly NodeResponse[]> {
  const response = NodeListEnvelopeSchema.parse(await api.get("nodes").json())
  return response.nodes
}

export async function createNode(input: CreateNodeRequest): Promise<NodeResponse> {
  const parsed = CreateNodeRequestSchema.parse(input)
  return NodeResponseSchema.parse(await api.post("nodes", { json: parsed }).json())
}

export async function updateNode(id: string, input: UpdateNodeRequest): Promise<NodeResponse> {
  const parsed = UpdateNodeRequestSchema.parse(input)
  return NodeResponseSchema.parse(await api.patch(`nodes/${id}`, { json: parsed }).json())
}

export async function testNodeConnection(id: string): Promise<NodeResponse> {
  return NodeResponseSchema.parse(await api.post(`nodes/${id}/test-connection`).json())
}

export async function testNodeAuth(id: string): Promise<AuthTestResponse> {
  return AuthTestResponseSchema.parse(await api.post(`nodes/${id}/test-auth`).json())
}

export async function probeNode(
  id: string,
): Promise<{ node: NodeResponse; probe: NodeProbeResponse }> {
  const ProbeEnvelopeSchema = z.object({
    node: NodeResponseSchema,
    probe: NodeProbeResponseSchema,
  })
  return ProbeEnvelopeSchema.parse(await api.post(`nodes/${id}/probe`).json())
}

export async function getProbeResults(nodeId: string): Promise<{ results: readonly unknown[] }> {
  const ProbeResultsSchema = z.object({ results: z.array(z.unknown()) })
  return ProbeResultsSchema.parse(await api.get(`nodes/${nodeId}/probe-results`).json())
}

export async function listShares(): Promise<readonly ShareResponse[]> {
  const response = ShareListEnvelopeSchema.parse(await api.get("shares").json())
  return response.shares
}

export async function createShare(input: CreateShareRequest): Promise<ShareResponse> {
  const parsed = CreateShareRequestSchema.parse(input)
  return ShareResponseSchema.parse(await api.post("shares", { json: parsed }).json())
}

export async function updateShare(id: string, input: UpdateShareRequest): Promise<ShareResponse> {
  const parsed = UpdateShareRequestSchema.parse(input)
  return ShareResponseSchema.parse(await api.patch(`shares/${id}`, { json: parsed }).json())
}

export async function deleteShare(id: string): Promise<void> {
  await api.delete(`shares/${id}`)
}

const NfsPortInfoSchema = z.object({
  listeningPorts: z.array(z.number()),
  primaryPort: z.number().nullable(),
  defaultPortOk: z.boolean(),
  anyPortListening: z.boolean(),
  rawSsOutput: z.string().nullable(),
})

const NfsVersionInfoSchema = z.object({
  supportedVersions: z.array(z.enum(["3", "4", "4.1", "4.2"])),
  preferredVersion: z.enum(["3", "4", "4.1", "4.2"]).nullable(),
  rawVersionsOutput: z.string().nullable(),
})

const PreCheckSchema = z.object({
  passed: z.boolean(),
  sourceSshOk: z.boolean(),
  targetSshOk: z.boolean(),
  sourceSudoOk: z.boolean().default(false),
  targetSudoOk: z.boolean().default(false),
  nfsPort2049Ok: z.boolean(),
  nfsPortInfo: NfsPortInfoSchema,
  nfsVersionInfo: NfsVersionInfoSchema,
  nfsServerInstalled: z.boolean(),
  nfsClientInstalled: z.boolean(),
  nfsServerRunning: z.boolean(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  summary: z.string(),
})

export type PreCheckResponse = z.infer<typeof PreCheckSchema>
export type NfsPortInfo = z.infer<typeof NfsPortInfoSchema>

export async function generateSharePlan(
  id: string,
): Promise<{ plan: PlanResponse; preCheck?: PreCheckResponse | undefined }> {
  const PlanEnvelopeSchema = z.object({
    plan: PlanResponseSchema,
    preCheck: PreCheckSchema.optional(),
  })
  return PlanEnvelopeSchema.parse(await api.post(`shares/${id}/plan`, { timeout: 120_000 }).json())
}

export async function getSharePlan(id: string): Promise<{ plan: PlanResponse }> {
  const PlanEnvelopeSchema = z.object({ plan: PlanResponseSchema })
  return PlanEnvelopeSchema.parse(await api.get(`shares/${id}/plan`).json())
}

export async function applySharePlan(
  shareId: string,
  planId: string,
): Promise<{
  results: readonly { stepKey: string; status: string; error?: string | undefined }[]
  allSucceeded: boolean
}> {
  const ApplyResponseSchema = z.object({
    results: z.array(
      z.object({ stepKey: z.string(), status: z.string(), error: z.string().optional() }),
    ),
    allSucceeded: z.boolean(),
  })
  return ApplyResponseSchema.parse(
    await api.post(`shares/${shareId}/apply`, { json: { planId }, timeout: 120_000 }).json(),
  )
}

export async function checkShareHealth(shareId: string): Promise<{ health: HealthCheckResponse }> {
  const HealthEnvelopeSchema = z.object({ health: HealthCheckResponseSchema })
  return HealthEnvelopeSchema.parse(
    await api.post(`shares/${shareId}/check`, { timeout: 60_000 }).json(),
  )
}

export async function getShareHealthChecks(
  shareId: string,
): Promise<{ checks: readonly HealthCheckResponse[] }> {
  const HealthListSchema = z.object({ checks: z.array(HealthCheckResponseSchema) })
  return HealthListSchema.parse(await api.get(`shares/${shareId}/health-checks`).json())
}

export async function disableShare(shareId: string): Promise<{ status: string }> {
  return z
    .object({ status: z.string() })
    .parse(await api.post(`shares/${shareId}/disable`, { timeout: 60_000 }).json())
}

export async function enableShare(shareId: string): Promise<{ status: string }> {
  return z
    .object({ status: z.string() })
    .parse(await api.post(`shares/${shareId}/enable`, { timeout: 60_000 }).json())
}

export async function remountShare(shareId: string): Promise<{ status: string }> {
  return z
    .object({ status: z.string() })
    .parse(await api.post(`shares/${shareId}/remount`, { timeout: 60_000 }).json())
}

export async function getAuditLogs(): Promise<{ logs: readonly unknown[] }> {
  const AuditLogsSchema = z.object({ logs: z.array(z.unknown()) })
  return AuditLogsSchema.parse(await api.get("audit-logs").json())
}

export async function checkInterconnectivity(
  sourceId: string,
  targetId: string,
  options?: {
    readonly sourcePath?: string
    readonly targetPath?: string
    readonly accessMode?: ShareAccessMode
  },
): Promise<InterconnectivityResponse> {
  const searchParams = new URLSearchParams()
  if (options?.sourcePath) {
    searchParams.set("sourcePath", options.sourcePath)
  }
  if (options?.targetPath) {
    searchParams.set("targetPath", options.targetPath)
  }
  if (options?.accessMode) {
    searchParams.set("accessMode", options.accessMode)
  }
  const query = searchParams.toString()
  const url =
    query.length > 0
      ? `interconnect/${sourceId}/${targetId}?${query}`
      : `interconnect/${sourceId}/${targetId}`
  return InterconnectivityResponseSchema.parse(await api.get(url, { timeout: 60_000 }).json())
}

export async function browseDirectories(nodeId: string, path: string): Promise<BrowseResponse> {
  const searchParams = path.length > 0 ? { path } : undefined
  return BrowseResponseSchema.parse(
    await api.get(`nodes/${nodeId}/browse`, { searchParams }).json(),
  )
}

export async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    const payload = await error.response.json()
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload)
    return parsed.success ? parsed.data.error.message : "请求失败。"
  }

  if (error instanceof Error) {
    return error.message
  }

  return "发生未知错误。"
}
