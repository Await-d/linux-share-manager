import { z } from "zod"

const ReachableStatusSchema = z.enum(["unknown", "ok", "failed"])

const NodeEndpointSchema = z.object({
  nodeId: z.uuid(),
  nodeName: z.string(),
  host: z.string(),
  port: z.number().int(),
  reachable: ReachableStatusSchema,
})

export const InterconnectivityResponseSchema = z.object({
  source: NodeEndpointSchema,
  target: NodeEndpointSchema,
  crossReachable: ReachableStatusSchema,
  nfsPort: z.number().int().nullable(),
  mountStatus: z.enum(["unknown", "mounted", "not_mounted"]).default("unknown"),
  readTest: z.enum(["unknown", "ok", "failed"]).default("unknown"),
  writeTest: z.enum(["unknown", "ok", "failed"]).default("unknown"),
  mountDetail: z.string().nullable().default(null),
  exportStatus: z.enum(["unknown", "ok", "not_exported"]).default("unknown"),
  exportDetail: z.string().nullable().default(null),
  summary: z.string(),
})

export type InterconnectivityResponse = z.infer<typeof InterconnectivityResponseSchema>
