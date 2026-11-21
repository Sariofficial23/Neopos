import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, asc, count, desc, eq, isNull, max, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  checkThrottle,
  clearThrottle,
  hashPassword,
  HttpError,
  noteFailure,
  verifyPassword,
} from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { createTenant } from '../tenant.js'

const { platformAdmins, platformSettings, tenants, users, roles, terminals, receipts } = schema

const loginRe = /^[a-z0-9._-]{3,32}$/
/** Логин администратора платформы: можно и e-mail (admin@neopos.com). */
const adminLoginRe = /^[a-z0-9._@+-]{3,64}$/

// ───────────── Настройки платформы ─────────────

/** Открыта ли самостоятельная регистрация брендов. ALLOW_REGISTER=false на сервере закрывает её всегда. */
export async function registrationOpen(db: DB): Promise<boolean> {
  if (process.env.ALLOW_REGISTER === 'false') return false
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'allowRegister'))
  return row ? row.value === true : true
}

/**
 * Первый администратор платформы.
 * На сервере: переменные SUPERADMIN_LOGIN и SUPERADMIN_PASSWORD (смена пароля в переменной
 * при следующем запуске меняет и пароль администратора).
 * При разработке без переменных: логин admin, пароль — в server/data/admin-credentials.txt.
 */
export async function ensurePlatformAdmin(db: DB, log: (msg: string) => void) {
  let login = process.env.SUPERADMIN_LOGIN?.trim().toLowerCase()
  let password = process.env.SUPERADMIN_PASSWORD
  const production = process.env.NODE_ENV === 'production'

  if (!login || !password) {
    const [any] = await db.select({ id: platformAdmins.id }).from(platformAdmins).limit(1)
    if (any) return
    if (production) {
      log('Администратор платформы не задан: укажите SUPERADMIN_LOGIN и SUPERADMIN_PASSWORD')
      return
    }
    login = 'admin'
    password = randomBytes(9).toString('base64url')
    const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/admin-credentials.txt')
    mkdirSync(dirname(file), { recursive: true })
    if (!existsSync(file)) writeFileSync(file, `login: ${login}\npassword: ${password}\n`)
    log(`Создан администратор платформы для разработки, данные: ${file}`)
  }
  if (!adminLoginRe.test(login)) {
    log('SUPERADMIN_LOGIN: латинские буквы, цифры и знаки . _ - @ +, от 3 до 64 символов, без пробелов')
    return
  }
  if (password.length < 8) {
    log('SUPERADMIN_PASSWORD: не короче 8 символов')
    return
  }

  const [existing] = await db.select().from(platformAdmins).where(eq(platformAdmins.login, login))
  if (!existing) {
    await db.insert(platformAdmins).values({ login, passwordHash: await hashPassword(password) })
  } else if (!(await verifyPassword(password, existing.passwordHash))) {
    await db
      .update(platformAdmins)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(platformAdmins.id, existing.id))
  }
}

// ───────────── Маршруты ─────────────

declare module 'fastify' {
  interface FastifyRequest {
    adminId: string
  }
}

export function adminRoutes(app: FastifyInstance, db: DB) {
  async function requireAdmin(req: FastifyRequest, _reply: FastifyReply) {
    try {
      await req.jwtVerify()
    } catch {
      throw new HttpError(401, 'unauthorized')
    }
    if (req.user.kind !== 'admin' || !req.user.sub) throw new HttpError(401, 'unauthorized')
    const [admin] = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.id, req.user.sub))
    if (!admin) throw new HttpError(401, 'unauthorized')
    req.adminId = admin.id
  }
  const guard = { preHandler: requireAdmin }

  app.get('/api/meta/public', async () => ({ allowRegister: await registrationOpen(db) }))

  app.post('/api/admin/login', async (req) => {
    const body = z.object({ login: z.string().trim().toLowerCase().max(64), password: z.string().max(200) }).parse(req.body)
    const key = `admin:${req.ip}`
    checkThrottle(key)
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.login, body.login))
    const ok = await verifyPassword(body.password, admin?.passwordHash ?? null)
    if (!admin || !ok) {
      noteFailure(key)
      throw new HttpError(401, 'bad_credentials')
    }
    clearThrottle(key)
    return { token: app.jwt.sign({ kind: 'admin', sub: admin.id }, { expiresIn: '12h' }), login: admin.login }
  })

  app.get('/api/admin/me', guard, async (req) => {
    const [admin] = await db.select({ login: platformAdmins.login }).from(platformAdmins).where(eq(platformAdmins.id, req.adminId))
    return { login: admin.login, allowRegister: await registrationOpen(db), registerLocked: process.env.ALLOW_REGISTER === 'false' }
  })

  app.patch('/api/admin/settings', guard, async (req) => {
    const { allowRegister } = z.object({ allowRegister: z.boolean() }).parse(req.body)
    await db
      .insert(platformSettings)
      .values({ key: 'allowRegister', value: allowRegister })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: allowRegister } })
    return { allowRegister: await registrationOpen(db) }
  })

  /** Владелец бренда — самый ранний действующий сотрудник с должностью владельца. */
  async function ownerOf(tenantId: string) {
    const [owner] = await db
      .select({ id: users.id, name: users.name, login: users.login })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, tenantId), eq(roles.isOwner, true), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt))
      .limit(1)
    return owner ?? null
  }

  app.get('/api/admin/tenants', guard, async () => {
    const list = await db.select().from(tenants).orderBy(desc(tenants.createdAt))
    const since = new Date(Date.now() - 30 * 86_400_000)
    const [owners, staff, devices, sales] = await Promise.all([
      db
        .select({ tenantId: users.tenantId, name: users.name, login: users.login, createdAt: users.createdAt })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(roles.isOwner, true), isNull(users.deletedAt)))
        .orderBy(asc(users.createdAt)),
      db
        .select({ tenantId: users.tenantId, n: count() })
        .from(users)
        .where(isNull(users.deletedAt))
        .groupBy(users.tenantId),
      db.select({ tenantId: terminals.tenantId, n: count() }).from(terminals).groupBy(terminals.tenantId),
      db
        .select({
          tenantId: receipts.tenantId,
          revenue30: sql<number>`coalesce(sum(case when ${receipts.closedAt} >= ${since} then ${receipts.total} else 0 end), 0)::bigint`.mapWith(Number),
          lastSale: max(receipts.closedAt),
        })
        .from(receipts)
        .where(eq(receipts.status, 'closed'))
        .groupBy(receipts.tenantId),
    ])
    const ownerBy = new Map<string, { name: string; login: string | null }>()
    for (const o of owners) if (!ownerBy.has(o.tenantId)) ownerBy.set(o.tenantId, o)
    const staffBy = new Map(staff.map((s) => [s.tenantId, s.n]))
    const devBy = new Map(devices.map((d) => [d.tenantId, d.n]))
    const salesBy = new Map(sales.map((s) => [s.tenantId, s]))
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      note: t.note,
      blocked: t.blocked,
      blockedAt: t.blockedAt,
      createdAt: t.createdAt,
      owner: ownerBy.get(t.id) ?? null,
      staff: staffBy.get(t.id) ?? 0,
      terminals: devBy.get(t.id) ?? 0,
      revenue30: salesBy.get(t.id)?.revenue30 ?? 0,
      lastSale: salesBy.get(t.id)?.lastSale ?? null,
    }))
  })

  app.post('/api/admin/tenants', guard, async (req) => {
    const body = z
      .object({
        venue: z.string().trim().min(2).max(80),
        name: z.string().trim().min(2).max(80),
        login: z.string().trim().toLowerCase().regex(loginRe),
        password: z.string().min(8).max(200),
        lang: z.enum(['uz', 'ru']).default('uz'),
        note: z.string().trim().max(500).nullish(),
      })
      .parse(req.body)
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.login, body.login))
    if (taken) throw new HttpError(409, 'login_taken')
    const { tenant } = await createTenant(db, {
      venue: body.venue,
      ownerName: body.name,
      login: body.login,
      password: body.password,
      lang: body.lang,
    })
    if (body.note) await db.update(tenants).set({ note: body.note }).where(eq(tenants.id, tenant.id))
    return { id: tenant.id }
  })

  app.patch('/api/admin/tenants/:id', guard, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = z
      .object({ name: z.string().trim().min(2).max(80), note: z.string().trim().max(500).nullable(), blocked: z.boolean() })
      .partial()
      .parse(req.body)
    const [t] = await db.select().from(tenants).where(eq(tenants.id, id))
    if (!t) throw new HttpError(404, 'not_found')
    const patch: Partial<typeof tenants.$inferInsert> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.note !== undefined) patch.note = body.note || null
    if (body.blocked !== undefined && body.blocked !== t.blocked) {
      patch.blocked = body.blocked
      patch.blockedAt = body.blocked ? new Date() : null
    }
    if (Object.keys(patch).length) await db.update(tenants).set(patch).where(eq(tenants.id, id))
    return { ok: true }
  })

  /** Новый пароль владельцу бренда. Если у владельца не было логина — задаётся и логин. */
  app.post('/api/admin/tenants/:id/reset-password', guard, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = z
      .object({ password: z.string().min(8).max(200), login: z.string().trim().toLowerCase().regex(loginRe).nullish() })
      .parse(req.body)
    const owner = await ownerOf(id)
    if (!owner) throw new HttpError(404, 'owner_not_found')
    const login = owner.login ?? body.login
    if (!login) throw new HttpError(400, 'login_required')
    if (!owner.login) {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.login, login))
      if (taken) throw new HttpError(409, 'login_taken')
    }
    await db
      .update(users)
      .set({ login, passwordHash: await hashPassword(body.password), active: true })
      .where(eq(users.id, owner.id))
    return { login }
  })
}
