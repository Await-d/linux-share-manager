import { z } from "zod"

const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/)

const PasswordSchema = z.string().min(12).max(256)

export const InitAdminRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
})

export const LoginRequestSchema = InitAdminRequestSchema

export const UserResponseSchema = z.object({
  id: z.uuid(),
  username: UsernameSchema,
})

export type InitAdminRequest = z.infer<typeof InitAdminRequestSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type UserResponse = z.infer<typeof UserResponseSchema>
