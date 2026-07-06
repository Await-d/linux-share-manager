import { z } from "zod"

const ShareAccessModeSchema = z.enum(["read_only", "read_write"])
const ShareStatusSchema = z.enum(["draft", "applying", "active", "failed"])

const AbsoluteLinuxPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^\/[^\0]*$/)

export const CreateShareRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sourceNodeId: z.uuid(),
  sourcePath: AbsoluteLinuxPathSchema,
  targetNodeId: z.uuid(),
  targetPath: AbsoluteLinuxPathSchema,
  accessMode: ShareAccessModeSchema,
  nfsVersion: z.enum(["4", "4.1", "4.2"]).default("4.2"),
  autoMount: z.boolean().default(true),
})

export const UpdateShareRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sourcePath: AbsoluteLinuxPathSchema.optional(),
  targetPath: AbsoluteLinuxPathSchema.optional(),
  accessMode: ShareAccessModeSchema.optional(),
  nfsVersion: z.enum(["4", "4.1", "4.2"]).optional(),
  autoMount: z.boolean().optional(),
  status: ShareStatusSchema.optional(),
})

export const ShareResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sourceNodeId: z.uuid(),
  sourcePath: z.string(),
  targetNodeId: z.uuid(),
  targetPath: z.string(),
  accessMode: ShareAccessModeSchema,
  nfsVersion: z.string(),
  autoMount: z.boolean(),
  status: ShareStatusSchema,
})

export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>
export type UpdateShareRequest = z.infer<typeof UpdateShareRequestSchema>
export type ShareResponse = z.infer<typeof ShareResponseSchema>
export type ShareStatus = z.infer<typeof ShareStatusSchema>
export type ShareAccessMode = z.infer<typeof ShareAccessModeSchema>
