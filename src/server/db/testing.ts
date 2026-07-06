import { type AppDatabase, createDatabase } from "./client"

export function createTestDatabase(): AppDatabase {
  return createDatabase(":memory:")
}
