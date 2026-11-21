import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { financeCategories, printers, users, roles, departments } = schema
const idParam = z.object({ id: z.string().uuid() })

type Seed = { uz: string; ru: string; children?: { uz: string; ru: string }[] }

/** Стартовые категории — чтобы кассир сразу мог провести расход. Владелец меняет их в панели. */
const DEFAULTS: Record<'expense' | 'income', Seed[]> = {
  expense: [
    { uz: 'Mahsulotlar', ru: 'Продукты', children: [{ uz: 'Bozor', ru: 'Базар' }, { uz: 'Go‘sht', ru: 'Мясо' }, { uz: 'Ichimliklar', ru: 'Напитки' }] },
    {
      uz: 'Kommunal xizmatlar',
      ru: 'Коммунальные',
      children: [{ uz: 'Internet', ru: 'Интернет' }, { uz: 'Telefon', ru: 'Телефон' }, { uz: 'Elektr', ru: 'Свет' }, { uz: 'Gaz', ru: 'Газ' }, { uz: 'Suv', ru: 'Вода' }],
    },
    { uz: 'Ish haqi', ru: 'Заработная плата', children: [{ uz: 'Avans', ru: 'Аванс' }, { uz: 'Bonus', ru: 'Бонус' }] },
    { uz: 'Xo‘jalik mollari', ru: 'Хозтовары' },
    { uz: 'Transport', ru: 'Транспорт', children: [{ uz: 'Taksi', ru: 'Такси' }, { uz: 'Yetkazib berish', ru: 'Доставка' }] },
    { uz: 'Ijara', ru: 'Аренда' },
    { uz: 'Boshqa xarajatlar', ru: 'Прочие расходы' },
  ],
  income: [{ uz: 'Mayda pul', ru: 'Размен' }, { uz: 'Egasidan', ru: 'От владельца' }, { uz: 'Boshqa daromad', ru: 'Прочий доход' }],
}

/** Создаёт стартовые категории, если у заведения их ещё нет. Язык — как у владельца. */
export async function ensureFinanceCategories(db: DB, tenantId: string) {
  const [any] = await db.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.tenantId, tenantId)).limit(1)
  if (any) return
  const [owner] = await db
    .select({ lang: users.lang })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.tenantId, tenantId), eq(roles.isOwner, true)))
    .limit(1)
  const lang: 'uz' | 'ru' = owner?.lang === 'ru' ? 'ru' : 'uz'
  await db.transaction(async (tx) => {
    for (const kind of ['expense', 'income'] as const) {
      for (const [i, top] of DEFAULTS[kind].entries()) {
        const [parent] = await tx
          .insert(financeCategories)
          .values({ tenantId, kind, name: top[lang], sort: i })
          .returning({ id: financeCategories.id })
        if (top.children?.length) {
          await tx.insert(financeCategories).values(
            top.children.map((c, j) => ({ tenantId, kind, parentId: parent.id, name: c[lang], sort: j })),
          )
        }
      }
    }
  })
}

async function listCategories(db: DB, tenantId: string) {
  await ensureFinanceCategories(db, tenantId)
  return db
    .select({
      id: financeCategories.id,
      kind: financeCategories.kind,
      parentId: financeCategories.parentId,
      name: financeCategories.name,
      sort: financeCategories.sort,
    })
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, tenantId), isNull(financeCategories.deletedAt)))
    .orderBy(asc(financeCategories.sort), asc(financeCategories.createdAt))
}

const printerBody = z.object({
  name: z.string().trim().min(1).max(60),
  ip: z
    .string()
    .trim()
    .regex(/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/, 'bad_ip'),
  port: z.number().int().min(1).max(65535).default(9100),
  width: z.union([z.literal(80), z.literal(58)]).default(80),
  departmentIds: z.array(z.string().uuid()).max(50).default([]),
  receipts: z.boolean().default(false),
  active: z.boolean().default(true),
})

export async function listPrinters(db: DB, tenantId: string) {
  return db
    .select({
      id: printers.id,
      name: printers.name,
      ip: printers.ip,
      port: printers.port,
      width: printers.width,
      departmentIds: printers.departmentIds,
      receipts: printers.receipts,
      active: printers.active,
    })
    .from(printers)
    .where(and(eq(printers.tenantId, tenantId), isNull(printers.deletedAt)))
    .orderBy(asc(printers.createdAt))
}

export function financeRoutes(app: FastifyInstance, db: DB) {
  const { requirePos, requirePerm } = makeAuthGuards(db)
  const can = (req: FastifyRequest, perm: string) => req.auth.role.permissions.includes(perm)

  // ───────────── Категории расходов и доходов ─────────────

  app.get('/api/pos/finance-categories', { preHandler: requirePos }, async (req) => listCategories(db, req.auth.tenantId))
  app.get('/api/finance-categories', { preHandler: requirePerm('settings.edit') }, async (req) => listCategories(db, req.auth.tenantId))

  const categoryBody = z.object({
    kind: z.enum(['expense', 'income']),
    name: z.string().trim().min(1).max(60),
    parentId: z.string().uuid().nullish(),
    sort: z.number().int().min(0).max(10000).default(0),
  })

  async function assertParent(tenantId: string, parentId: string | null | undefined, kind: string, selfId?: string) {
    if (!parentId) return
    if (parentId === selfId) throw new HttpError(400, 'bad_parent')
    const [p] = await db
      .select()
      .from(financeCategories)
      .where(and(eq(financeCategories.id, parentId), eq(financeCategories.tenantId, tenantId), isNull(financeCategories.deletedAt)))
    if (!p || p.kind !== kind || p.parentId) throw new HttpError(400, 'bad_parent')
  }

  app.post('/api/finance-categories', { preHandler: requirePerm('settings.edit') }, async (req) => {
    const body = categoryBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertParent(tenantId, body.parentId, body.kind)
    const [row] = await db.insert(financeCategories).values({ tenantId, ...body, parentId: body.parentId ?? null }).returning()
    return row
  })

  app.patch('/api/finance-categories/:id', { preHandler: requirePerm('settings.edit') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = categoryBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertParent(tenantId, body.parentId, body.kind, id)
    const [row] = await db
      .update(financeCategories)
      .set({ name: body.name, parentId: body.parentId ?? null, sort: body.sort })
      .where(and(eq(financeCategories.id, id), eq(financeCategories.tenantId, tenantId), isNull(financeCategories.deletedAt)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  // Удалённая категория остаётся в старых операциях; её подкатегории удаляются вместе с ней.
  app.delete('/api/finance-categories/:id', { preHandler: requirePerm('settings.edit') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const now = new Date()
    const [row] = await db
      .update(financeCategories)
      .set({ deletedAt: now })
      .where(and(eq(financeCategories.id, id), eq(financeCategories.tenantId, tenantId), isNull(financeCategories.deletedAt)))
      .returning({ id: financeCategories.id })
    if (!row) throw new HttpError(404, 'not_found')
    await db
      .update(financeCategories)
      .set({ deletedAt: now })
      .where(and(eq(financeCategories.parentId, id), eq(financeCategories.tenantId, tenantId), isNull(financeCategories.deletedAt)))
    return { ok: true }
  })

  // ───────────── Сетевые принтеры ─────────────

  app.get('/api/pos/printers', { preHandler: requirePos }, async (req) => listPrinters(db, req.auth.tenantId))

  async function assertDepartments(tenantId: string, ids: string[]) {
    if (!ids.length) return
    const own = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), isNull(departments.deletedAt)))
    const set = new Set(own.map((d) => d.id))
    if (ids.some((d) => !set.has(d))) throw new HttpError(400, 'bad_department')
  }

  app.post('/api/pos/printers', { preHandler: requirePos }, async (req) => {
    if (!can(req, 'settings.edit')) throw new HttpError(403, 'no_permission')
    const body = printerBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertDepartments(tenantId, body.departmentIds)
    const [row] = await db.insert(printers).values({ tenantId, ...body, departmentIds: [...new Set(body.departmentIds)] }).returning()
    return row
  })

  app.patch('/api/pos/printers/:id', { preHandler: requirePos }, async (req) => {
    if (!can(req, 'settings.edit')) throw new HttpError(403, 'no_permission')
    const { id } = idParam.parse(req.params)
    const body = printerBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertDepartments(tenantId, body.departmentIds)
    const [row] = await db
      .update(printers)
      .set({ ...body, departmentIds: [...new Set(body.departmentIds)] })
      .where(and(eq(printers.id, id), eq(printers.tenantId, tenantId), isNull(printers.deletedAt)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  app.delete('/api/pos/printers/:id', { preHandler: requirePos }, async (req) => {
    if (!can(req, 'settings.edit')) throw new HttpError(403, 'no_permission')
    const { id } = idParam.parse(req.params)
    const [row] = await db
      .update(printers)
      .set({ deletedAt: new Date(), active: false })
      .where(and(eq(printers.id, id), eq(printers.tenantId, req.auth.tenantId), isNull(printers.deletedAt)))
      .returning({ id: printers.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })
}
