import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite"
import { migrateDatabase } from "./migrate"
import * as schema from "./schema"

export type AppDatabase = {
  readonly sqlite: Database
  readonly db: BunSQLiteDatabase<typeof schema>
  readonly close: () => void
}

export function createDatabase(path: string): AppDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }

  const sqlite = new Database(path, { create: true, strict: true })
  migrateDatabase(sqlite)

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  }
}
