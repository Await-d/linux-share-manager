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
import {
  type CreateNodeRequest,
  CreateNodeRequestSchema,
  type NodeResponse,
  NodeResponseSchema,
} from "../../shared/schemas/nodes"

const AuthStatusSchema = z.object({ initialized: z.boolean() })
const UserEnvelopeSchema = z.object({ user: UserResponseSchema })
const NodeListEnvelopeSchema = z.object({ nodes: z.array(NodeResponseSchema) })

const api = ky.create({
  prefix: `${window.location.origin}/api`,
  credentials: "include",
  timeout: 10_000,
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
