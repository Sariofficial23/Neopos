import { and, asc, count, eq, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hashPassword, hashPin, HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { sanitizePermissions } from '../permissions.js'

const idParam = z.object({ id: z.string().uuid() })

const roleBody = z.object({
  name: z.string().trim().min(2).max(60),
  panelAccess: z.boolean(),
  terminalAccess: z.boolean(),
  permissions: z.array(z.string()).max(100),
})

const staffBody = z.object({
  name: z.string().trim().min(2).max(80),
  roleId: z.string().uuid(),
  phone: z.string().trim().max(32).nullish(),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/)
    .nullish(),
  /** Пустая строка или отсутствие — не менять */
  password: z.string().min(8).max(200).nullish(),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .nullish(),
  lang: z.enum(['uz', 'ru']).default('uz'),
  active: z.boolean().default(true),
})

export function staffRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const { roles, users } = schema

  // ───────────── Должности ─────────────

  app.get('/api/roles', { preHandler: requirePerm('staff.view') }, async (req) => {
    const rows = await db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, req.auth.tenantId))
      .orderBy(asc(roles.createdAt))
    const counts = await db
      .select({ roleId: users.roleId, n: count() })
      .from(users)
      .where(and(eq(users.tenantId, req.auth.tenantId), isNull(users.deletedAt)))
      .groupBy(users.roleId)
    const byRole = new Map(counts.map((c) => [c.roleId, c.n]))
    return rows.map((r) => ({ ...r, staffCount: byRole.get(r.id) ?? 0 }))
  })

  app.post('/api/roles', { preHandler: requirePerm('staff.edit') }, async (req) => {
    const body = roleBody.parse(req.body)
    const [row] = await db
      .insert(roles)
      .values({
        tenantId: req.auth.tenantId,
        ...body,
        permissions: sanitizePermissions(body.permissions),
      })
      .returning()
    return row
  })

  app.patch('/api/roles/:id', { preHandler: requirePerm('staff.edit') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = roleBody.parse(req.body)
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, req.auth.tenantId)))
    if (!existing) throw new HttpError(404, 'not_found')
    // У должности владельца меняется только название: права всегда полные.
    const patch = existing.isOwner
      ? { name: body.name }
      : { ...body, permissions: sanitizePermissions(body.permissions) }
    const [row] = await db.update(roles).set(patch).where(eq(roles.id, id)).returning()
    return row
  })

  app.delete('/api/roles/:id', { preHandler: requirePerm('staff.edit') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, req.auth.tenantId)))
    if (!existing) throw new HttpError(404, 'not_found')
    if (existing.isOwner) throw new HttpError(400, 'owner_role_locked')
    // Удалённые сотрудники тоже ссылаются на должность, поэтому считаем всех.
    const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.roleId, id))
    if (n > 0) throw new HttpError(409, 'role_in_use')
    await db.delete(roles).where(eq(roles.id, id))
    return { ok: true }
  })

  // ───────────── Сотрудники ─────────────

  const publicUser = {
    id: users.id,
    name: users.name,
    phone: users.phone,
    login: users.login,
    lang: users.lang,
    active: users.active,
    roleId: users.roleId,
    roleName: roles.name,
    isOwner: roles.isOwner,
    hasPin: users.pinHash,
    pin: users.pin,
    createdAt: users.createdAt,
  }

  app.get('/api/staff', { preHandler: requirePerm('staff.view') }, async (req) => {
    const rows = await db
      .select(publicUser)
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, req.auth.tenantId), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt))
    // ПИН-коды видит только тот, кто может править сотрудников; ПИН владельца — только владелец.
    const canSee = req.auth.role.permissions.includes('staff.edit')
    return rows.map((r) => ({ ...r, hasPin: r.hasPin != null, pin: canSee && (!r.isOwner || req.auth.role.isOwner) ? r.pin : null }))
  })

  async function loadRole(tenantId: string, roleId: string) {
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
    if (!role) throw new HttpError(400, 'bad_role')
    return role
  }

  async function assertLoginFree(login: string, exceptId?: string) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(exceptId ? and(eq(users.login, login), ne(users.id, exceptId)) : eq(users.login, login))
    if (taken) throw new HttpError(409, 'login_taken')
  }

  async function assertPinFree(tenantId: string, pinHash: string, exceptId?: string) {
    const cond = and(eq(users.tenantId, tenantId), eq(users.pinHash, pinHash))
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(exceptId ? and(cond, ne(users.id, exceptId)) : cond)
    if (taken) throw new HttpError(409, 'pin_taken')
  }

  app.post('/api/staff', { preHandler: requirePerm('staff.edit') }, async (req) => {
    const body = staffBody.parse(req.body)
    const tenantId = req.auth.tenantId
    const role = await loadRole(tenantId, body.roleId)
    if (role.isOwner && !req.auth.role.isOwner) throw new HttpError(403, 'forbidden')
    if (body.login && !body.password) throw new HttpError(400, 'password_required')
    if (body.login) await assertLoginFree(body.login)
    const pinHash = body.pin ? hashPin(tenantId, body.pin) : null
    if (pinHash) await assertPinFree(tenantId, pinHash)

    const [row] = await db
      .insert(users)
      .values({
        tenantId,
        roleId: body.roleId,
        name: body.name,
        phone: body.phone || null,
        login: body.login || null,
        passwordHash: body.login && body.password ? await hashPassword(body.password) : null,
        pinHash,
        pin: body.pin || null,
        lang: body.lang,
        active: body.active,
      })
      .returning({ id: users.id })
    return row
  })

  app.patch('/api/staff/:id', { preHandler: requirePerm('staff.edit') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = staffBody.parse(req.body)
    const tenantId = req.auth.tenantId
    const [existing] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
    if (!existing) throw new HttpError(404, 'not_found')

    const newRole = await loadRole(tenantId, body.roleId)
    const touchesOwner = existing.role.isOwner || newRole.isOwner
    if (touchesOwner && !req.auth.role.isOwner) throw new HttpError(403, 'forbidden')
    // Нельзя оставить заведение без действующего владельца.
    if (existing.role.isOwner && (!newRole.isOwner || !body.active)) {
      await assertAnotherOwner(tenantId, id)
    }
    if (id === req.auth.userId && !body.active) throw new HttpError(400, 'cannot_disable_self')

    if (body.login) await assertLoginFree(body.login, id)
    if (body.login && !body.password && !existing.user.passwordHash) {
      throw new HttpError(400, 'password_required')
    }
    const patch: Partial<typeof users.$inferInsert> = {
      roleId: body.roleId,
      name: body.name,
      phone: body.phone || null,
      login: body.login || null,
      lang: body.lang,
      active: body.active,
    }
    if (!body.login) patch.passwordHash = null
    else if (body.password) patch.passwordHash = await hashPassword(body.password)
    if (body.pin) {
      const pinHash = hashPin(tenantId, body.pin)
      await assertPinFree(tenantId, pinHash, id)
      patch.pinHash = pinHash
      patch.pin = body.pin
    }
    await db.update(users).set(patch).where(eq(users.id, id))
    return { ok: true }
  })

  async function assertAnotherOwner(tenantId: string, exceptId: string) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(roles.isOwner, true),
          eq(users.active, true),
          isNull(users.deletedAt),
          ne(users.id, exceptId),
        ),
      )
    if (n === 0) throw new HttpError(400, 'last_owner')
  }

  app.delete('/api/staff/:id', { preHandler: requirePerm('staff.edit') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    if (id === req.auth.userId) throw new HttpError(400, 'cannot_delete_self')
    const [existing] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
    if (!existing) throw new HttpError(404, 'not_found')
    if (existing.role.isOwner) {
      if (!req.auth.role.isOwner) throw new HttpError(403, 'forbidden')
      await assertAnotherOwner(tenantId, id)
    }
    // Мягкое удаление: чеки сотрудника остаются в отчётах. Логин и ПИН освобождаются.
    await db
      .update(users)
      .set({ deletedAt: new Date(), active: false, login: null, passwordHash: null, pinHash: null, pin: null })
      .where(eq(users.id, id))
    return { ok: true }
  })
}
