import { z } from "zod"

const ShareAccessModeSchema = z.enum(["read_only", "read_write"])
const NfsVersionSchema = z.enum(["auto", "3", "4", "4.1", "4.2"])
const ShareStatusSchema = z.enum([
  "draft",
  "planned",
  "applying",
  "active",
  "degraded",
  "partial_failed",
  "disabled",
  "unmounted",
  "deleting",
  "deleted",
])

const AbsoluteLinuxPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^\/[^\0]*$/)
  .refine((path) => !path.split("/").some((part) => part === "." || part === ".."), {
    message: "Path cannot contain . or .. components.",
  })

export const CreateShareRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sourceNodeId: z.uuid(),
  sourcePath: AbsoluteLinuxPathSchema,
  targetNodeId: z.uuid(),
  targetPath: AbsoluteLinuxPathSchema,
  accessMode: ShareAccessModeSchema,
  nfsVersion: NfsVersionSchema.default("auto"),
  autoMount: z.boolean().default(true),
})

export const UpdateShareRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sourcePath: AbsoluteLinuxPathSchema.optional(),
  targetPath: AbsoluteLinuxPathSchema.optional(),
  accessMode: ShareAccessModeSchema.optional(),
  nfsVersion: NfsVersionSchema.optional(),
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

export const PlanResponseSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  version: z.number(),
  status: z.string(),
  riskLevel: z.string(),
  plan: z.unknown(),
  results: z
    .array(z.object({ stepKey: z.string(), status: z.string(), error: z.string().optional() }))
    .default([]),
  createdBy: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const HealthCheckResponseSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  status: z.string(),
  sourceOnline: z.boolean(),
  targetOnline: z.boolean(),
  nfsServiceOk: z.boolean().nullable(),
  mountpointOk: z.boolean().nullable(),
  readOk: z.boolean().nullable(),
  writeOk: z.boolean().nullable(),
  latencyMs: z.number().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  summary: z.string(),
  createdAt: z.string(),
})

export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>
export type UpdateShareRequest = z.infer<typeof UpdateShareRequestSchema>
export type ShareResponse = z.infer<typeof ShareResponseSchema>
export type ShareStatus = z.infer<typeof ShareStatusSchema>
export type ShareAccessMode = z.infer<typeof ShareAccessModeSchema>
export type PlanResponse = z.infer<typeof PlanResponseSchema>
export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>
