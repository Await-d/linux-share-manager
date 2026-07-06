import { z } from "zod"

const NodeRoleSchema = z.enum(["source", "target", "both"])
const NodeAuthTypeSchema = z.enum(["private_key", "password_session"])
const ProbeStatusSchema = z.enum(["unknown", "ok", "failed"])

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
  port: z.number().int().min(1).max(65535).default(22),
  username: LinuxUsernameSchema,
  authType: NodeAuthTypeSchema,
  role: NodeRoleSchema,
})

export const NodeResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  username: z.string(),
  authType: NodeAuthTypeSchema,
  role: NodeRoleSchema,
  osFamily: z.string().nullable(),
  primaryIp: z.string().nullable(),
  lastProbeStatus: ProbeStatusSchema,
})

export type CreateNodeRequest = z.infer<typeof CreateNodeRequestSchema>
export type NodeResponse = z.infer<typeof NodeResponseSchema>
