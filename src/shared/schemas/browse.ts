import { z } from "zod"

const AbsoluteLinuxPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^\/[^\0]*$/)

export const BrowseQuerySchema = z.object({
  path: AbsoluteLinuxPathSchema.optional(),
})

const BrowseEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
})

export const BrowseResponseSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(BrowseEntrySchema),
})

export type BrowseQuery = z.infer<typeof BrowseQuerySchema>
export type BrowseEntry = z.infer<typeof BrowseEntrySchema>
export type BrowseResponse = z.infer<typeof BrowseResponseSchema>
