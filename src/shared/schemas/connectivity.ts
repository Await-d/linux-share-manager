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
  summary: z.string(),
})

export type InterconnectivityResponse = z.infer<typeof InterconnectivityResponseSchema>
