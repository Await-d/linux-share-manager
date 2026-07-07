import { and, eq, gt } from "drizzle-orm"
import type { AppConfig } from "../config"
import type { AppDatabase } from "../db/client"
import { sessions, users } from "../db/schema"
import { AppError, DatabaseInvariantError } from "../errors"
import { logger } from "../logger"
import type { AuthenticatedUser, SessionRecord } from "./types"

type AuthServiceOptions = {
  readonly database: AppDatabase
  readonly config: AppConfig
}

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  hasUsers(): boolean {
    return this.options.database.db.select({ id: users.id }).from(users).limit(1).all().length > 0
  }

  async initializeAdmin(username: string, password: string): Promise<SessionRecord> {
    if (this.hasUsers()) {
      throw new AppError("ALREADY_INITIALIZED", "The administrator account already exists.", 409)
    }

    const now = new Date()
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" })
    const created = this.options.database.db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        username,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()

    const user = created.at(0)
    if (user === undefined) {
      throw new DatabaseInvariantError("user insert returned no row")
    }

    logger.info({ username }, "admin initialized")
    return this.createSession({ id: user.id, username: user.username })
  }

  async login(username: string, password: string): Promise<SessionRecord> {
    const found = this.options.database.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1)
      .all()
      .at(0)

    if (found === undefined) {
      logger.warn({ username }, "login failed: user not found")
      throw new AppError("INVALID_CREDENTIALS", "Invalid username or password.", 401)
    }

    const valid = await Bun.password.verify(password, found.passwordHash)
    if (!valid) {
      logger.warn({ username }, "login failed: invalid password")
      throw new AppError("INVALID_CREDENTIALS", "Invalid username or password.", 401)
    }

    this.options.database.db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, found.id))
      .run()

    logger.info({ username }, "login succeeded")
    return this.createSession({ id: found.id, username: found.username })
  }

  findSession(sessionId: string): SessionRecord | null {
    const now = new Date()
    const row = this.options.database.db
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        username: users.username,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
      .limit(1)
      .all()
      .at(0)

    if (row === undefined) {
      return null
    }

    return {
      id: row.sessionId,
      expiresAt: row.expiresAt,
      user: {
        id: row.userId,
        username: row.username,
      },
    }
  }

  logout(sessionId: string): void {
    this.options.database.db.delete(sessions).where(eq(sessions.id, sessionId)).run()
    logger.info({ sessionId: sessionId.slice(0, 8) }, "session logged out")
  }

  private createSession(user: AuthenticatedUser): SessionRecord {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.options.config.sessionTtlSeconds * 1000)
    const sessionId = crypto.randomUUID()

    this.options.database.db
      .insert(sessions)
      .values({
        id: sessionId,
        userId: user.id,
        expiresAt,
        createdAt: now,
      })
      .run()

    return { id: sessionId, user, expiresAt }
  }
}
