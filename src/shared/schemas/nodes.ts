import { z } from "zod"

const NodeRoleSchema = z.enum(["source", "target", "both"])
const NodeAuthTypeSchema = z.enum(["private_key", "password_session"])
const CredentialStatusSchema = z.enum(["missing", "password_set", "private_key_set"])
const ProbeStatusSchema = z.enum(["unknown", "ok", "failed"])
const NodePortSchema = z.number().int().min(1).max(65535)

const HostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9:._-]+$/)

const LinuxUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*[$]?$/)

export const CreateNodeRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: HostSchema,
  port: NodePortSchema.default(22),
  username: LinuxUsernameSchema,
  authType: NodeAuthTypeSchema,
  password: z.string().min(1).max(4096).optional(),
  privateKey: z.string().min(1).max(32_768).optional(),
  privateKeyName: z.string().trim().min(1).max(120).optional(),
  role: NodeRoleSchema,
})

export const UpdateNodeRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  host: HostSchema.optional(),
  port: NodePortSchema.optional(),
  username: LinuxUsernameSchema.optional(),
  authType: NodeAuthTypeSchema.optional(),
  password: z.string().min(1).max(4096).optional(),
  privateKey: z.string().min(1).max(32_768).optional(),
  privateKeyName: z.string().trim().min(1).max(120).optional(),
  role: NodeRoleSchema.optional(),
})

export const NodeResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  username: z.string(),
  authType: NodeAuthTypeSchema,
  credentialStatus: CredentialStatusSchema,
  credentialLabel: z.string().nullable(),
  role: NodeRoleSchema,
  osFamily: z.string().nullable(),
  primaryIp: z.string().nullable(),
  lastProbeStatus: ProbeStatusSchema,
})

export type CreateNodeRequest = z.infer<typeof CreateNodeRequestSchema>
export type UpdateNodeRequest = z.infer<typeof UpdateNodeRequestSchema>
export type NodeResponse = z.infer<typeof NodeResponseSchema>
