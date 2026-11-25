import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  checkThrottle,
  clearThrottle,
  HttpError,
  makeAuthGuards,
  noteFailure,
  verifyPassword,
} from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { PERMISSIONS } from '../permissions.js'
import { createTenant } from '../tenant.js'
import { registrationOpen } from './admin.js'
import { dayStartOf } from './settings.js'

const loginRe = /^[a-z0-9._-]{3,32}$/

export function authRoutes(app: FastifyInstance, db: DB) {
  const { requireAuth } = makeAuthGuards(db)

  const sign = (userId: string, tenantId: string) =>
    app.jwt.sign({ sub: userId, tid: tenantId }, { expiresIn: '30d' })

  app.post('/api/auth/register', async (req) => {
    if (!(await registrationOpen(db))) throw new HttpError(403, 'registration_closed')
    const body = z
      .object({
        venue: z.string().trim().min(2).max(80),
        name: z.string().trim().min(2).max(80),
        login: z.string().trim().toLowerCase().regex(loginRe),
        password: z.string().min(8).max(200),
        lang: z.enum(['uz', 'ru']).default('uz'),
      })
      .parse(req.body)

    const [taken] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, body.login))
    if (taken) throw new HttpError(409, 'login_taken')

    const { owner, tenant } = await createTenant(db, {
      venue: body.venue,
      ownerName: body.name,
      login: body.login,
      password: body.password,
      lang: body.lang,
    })
    return { token: sign(owner.id, tenant.id) }
  })

  app.post('/api/auth/login', async (req) => {
    const body = z
      .object({ login: z.string().trim().toLowerCase().max(64), password: z.string().max(200) })
      .parse(req.body)
    const key = `${req.ip}:${body.login}`
    checkThrottle(key)

    const [user] = await db.select().from(schema.users).where(eq(schema.users.login, body.login))
    const ok = await verifyPassword(body.password, user?.passwordHash ?? null)
    if (!user || !ok || !user.active || user.deletedAt) {
      noteFailure(key)
      throw new HttpError(401, 'bad_credentials')
    }
    clearThrottle(key)
    const [tenant] = await db.select({ blocked: schema.tenants.blocked }).from(schema.tenants).where(eq(schema.tenants.id, user.tenantId))
    if (tenant?.blocked) throw new HttpError(403, 'venue_blocked')
    return { token: sign(user.id, user.tenantId) }
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const [tenant] = await db
      .select({ id: schema.tenants.id, name: schema.tenants.name, currency: schema.tenants.currency, settings: schema.tenants.settings })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, req.auth.tenantId))
    const { settings, ...rest } = tenant
    // Панели нужен час начала рабочего дня, чтобы «Сегодня» совпадало с кассой.
    return { user: req.auth, tenant: { ...rest, dayStartHour: dayStartOf(settings) } }
  })

  app.get('/api/meta/permissions', { preHandler: requireAuth }, async () => PERMISSIONS)
}
