export class AppError extends Error {
  readonly name = "AppError"

  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
  ) {
    super(message)
  }
}

export class DatabaseInvariantError extends Error {
  readonly name = "DatabaseInvariantError"
}
