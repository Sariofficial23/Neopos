import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { schema, type DB } from './db/index.js'
import { ALL_PERMISSIONS } from './permissions.js'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

/** Секрет для подписи токенов и ПИН-кодов. В бою задаётся через JWT_SECRET. */
export function getSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production')
  }
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../data/.dev-secret')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  mkdirSync(dirname(file), { recursive: true })
  const secret = randomBytes(32).toString('hex')
  writeFileSync(file, secret)
  return secret
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [ver, saltHex, hashHex] = stored.split('$')
  if (ver !== 's1' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

/**
 * Ключ ПИН-кодов заведения. Он свой у каждого заведения и выводится из секрета сервера,
 * поэтому его можно передать главному терминалу этого заведения (работа без интернета),
 * не раскрывая общий секрет. Локальный сервер получает ключ при обмене с облаком.
 */
const pinKeys = new Map<string, string>()
export function setPinKey(tenantId: string, key: string) {
  pinKeys.set(tenantId, key)
}
export function pinKey(tenantId: string): string {
  return pinKeys.get(tenantId) ?? createHmac('sha256', getSecret()).update(`pin-key:${tenantId}`).digest('hex')
}

/** Детерминированный хеш ПИН-кода внутри заведения: по нему ищем сотрудника на терминале. */
export function hashPin(tenantId: string, pin: string): string {
  return createHmac('sha256', pinKey(tenantId)).update(`${tenantId}:${pin}`).digest('hex')
}

/** Прежний способ (общий секрет сервера): нужен, чтобы старые ПИН-коды продолжали работать и обновлялись при входе. */
export function legacyHashPin(tenantId: string, pin: string): string {
  return createHmac('sha256', getSecret()).update(`${tenantId}:${pin}`).digest('hex')
}

export type AuthContext = {
  userId: string
  tenantId: string
  name: string
  lang: string
  role: {
    id: string
    name: string
    isOwner: boolean
    panelAccess: boolean
    terminalAccess: boolean
    permissions: string[]
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // kind: 'device' — токен привязанного устройства кассы, сам по себе доступа к данным не даёт
    // kind: 'admin' — администратор платформы NeoPos, к данным заведений напрямую доступа не имеет
    payload: { sub?: string; tid?: string; kind?: 'device' | 'admin'; did?: string }
    user: { sub?: string; tid?: string; kind?: 'device' | 'admin'; did?: string }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code)
  }
}

/** Загружает сотрудника и должность из базы на каждый запрос — блокировка действует сразу. */
export function makeAuthGuards(db: DB) {
  async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
    try {
      await req.jwtVerify()
    } catch {
      throw new HttpError(401, 'unauthorized')
    }
    const { sub, tid, kind } = req.user
    if (!sub || !tid || kind) throw new HttpError(401, 'unauthorized')
    const [row] = await db
      .select({ user: schema.users, role: schema.roles, blocked: schema.tenants.blocked })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.users.tenantId))
      .where(
        and(
          eq(schema.users.id, sub),
          eq(schema.users.tenantId, tid),
          isNull(schema.users.deletedAt),
        ),
      )
    if (!row || !row.user.active) throw new HttpError(401, 'unauthorized')
    // Заблокированный бренд теряет доступ сразу, даже с уже выданным токеном.
    if (row.blocked) throw new HttpError(403, 'venue_blocked')
    req.auth = {
      userId: row.user.id,
      tenantId: row.user.tenantId,
      name: row.user.name,
      lang: row.user.lang,
      role: {
        id: row.role.id,
        name: row.role.name,
        isOwner: row.role.isOwner,
        panelAccess: row.role.isOwner || row.role.panelAccess,
        terminalAccess: row.role.isOwner || row.role.terminalAccess,
        permissions: row.role.isOwner ? ALL_PERMISSIONS : row.role.permissions,
      },
    }
  }

  const requirePanel = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply)
    if (!req.auth.role.panelAccess) throw new HttpError(403, 'forbidden')
  }

  const requirePerm = (perm: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    await requirePanel(req, reply)
    if (!req.auth.role.permissions.includes(perm)) throw new HttpError(403, 'forbidden')
  }

  /** Доступ к кассе: любой сотрудник, у чьей должности включён терминал. */
  const requirePos = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply)
    if (!req.auth.role.terminalAccess) throw new HttpError(403, 'forbidden')
  }

  return { requireAuth, requirePanel, requirePerm, requirePos }
}

/** Простая защита от перебора пароля: 5 ошибок — пауза на минуту. */
const attempts = new Map<string, { n: number; until: number }>()
export function checkThrottle(key: string) {
  const a = attempts.get(key)
  if (a && a.until > Date.now() && a.n >= 5) throw new HttpError(429, 'too_many_attempts')
}
export function noteFailure(key: string) {
  const now = Date.now()
  const a = attempts.get(key)
  if (!a || a.until < now) attempts.set(key, { n: 1, until: now + 60_000 })
  else a.n++
}
export function clearThrottle(key: string) {
  attempts.delete(key)
}
