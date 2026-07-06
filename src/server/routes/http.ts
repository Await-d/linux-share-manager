import { ZodError } from "zod"
import { AppError } from "../errors"

export type ErrorPayload = {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

export function errorPayload(code: string, message: string): ErrorPayload {
  return { error: { code, message } }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  if (error instanceof ZodError) {
    return new AppError("VALIDATION_FAILED", "The request payload is invalid.", 422)
  }

  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", 500)
}
