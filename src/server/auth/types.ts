import type { UserResponse } from "../../shared/schemas/auth"

export type AuthenticatedUser = UserResponse

export type SessionRecord = {
  readonly id: string
  readonly user: AuthenticatedUser
  readonly expiresAt: Date
}
