import { and, asc, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const idParam = z.object({ id: z.string().uuid() })

/** Двуязычное название: достаточно заполнить один язык — второй подставится таким же. */
const l10n = z
  .object({ uz: z.string().trim().max(120).default(''), ru: z.string().trim().max(120).default('') })
  .refine((v) => v.uz.length > 0 || v.ru.length > 0, { message: 'name_required' })
  .transform((v) => ({ uz: v.uz || v.ru, ru: v.ru || v.uz }))

const departmentBody = z.object({
  name: z.string().trim().min(1).max(60),
  printer: z.string().trim().max(120).nullish(),
})

const categoryBody = z.object({
  name: l10n,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  sort: z.number().int().min(0).max(100000).default(0),
  active: z.boolean().default(true),
})

const productBody = z.object({
  name: l10n,
  categoryId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  price: z.number().int().min(0).max(1_000_000_000),
  barcode: z.string().trim().max(64).nullish(),
  unit: z.enum(['pcs', 'kg', 'l']).default('pcs'),
  byWeight: z.boolean().default(false),
  favorite: z.boolean().default(false),
  stopped: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(100000).default(0),
})

export function menuRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const view = { preHandler: requirePerm('menu.view') }
  const edit = { preHandler: requirePerm('menu.edit') }
  const { departments, categories, products } = schema

  // ───────────── Отделы ─────────────

  app.get('/api/departments', view, async (req) =>
    db
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, req.auth.tenantId), isNull(departments.deletedAt)))
      .orderBy(asc(departments.createdAt)),
  )

  app.post('/api/departments', edit, async (req) => {
    const body = departmentBody.parse(req.body)
    const [row] = await db
      .insert(departments)
      .values({ tenantId: req.auth.tenantId, name: body.name, printer: body.printer || null })
      .returning()
    return row
  })

  app.patch('/api/departments/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = departmentBody.parse(req.body)
    const [row] = await db
      .update(departments)
      .set({ name: body.name, printer: body.printer || null })
      .where(and(eq(departments.id, id), eq(departments.tenantId, req.auth.tenantId)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  app.delete('/api/departments/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const [{ n }] = await db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.departmentId, id), isNull(products.deletedAt)))
    if (n > 0) throw new HttpError(409, 'department_in_use')
    const [row] = await db
      .update(departments)
      .set({ deletedAt: new Date() })
      .where(and(eq(departments.id, id), eq(departments.tenantId, tenantId)))
      .returning({ id: departments.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })

  // ───────────── Категории ─────────────

  app.get('/api/categories', view, async (req) => {
    const tenantId = req.auth.tenantId
    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sort), asc(categories.createdAt))
    const counts = await db
      .select({ categoryId: products.categoryId, n: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .groupBy(products.categoryId)
    const by = new Map(counts.map((c) => [c.categoryId, c.n]))
    return rows.map((r) => ({ ...r, productCount: by.get(r.id) ?? 0 }))
  })

  app.post('/api/categories', edit, async (req) => {
    const body = categoryBody.parse(req.body)
    const [row] = await db
      .insert(categories)
      .values({ tenantId: req.auth.tenantId, ...body, color: body.color ?? null })
      .returning()
    return row
  })

  app.patch('/api/categories/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = categoryBody.parse(req.body)
    const [row] = await db
      .update(categories)
      .set({ ...body, color: body.color ?? null })
      .where(
        and(eq(categories.id, id), eq(categories.tenantId, req.auth.tenantId), isNull(categories.deletedAt)),
      )
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  app.delete('/api/categories/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const [{ n }] = await db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, id), isNull(products.deletedAt)))
    if (n > 0) throw new HttpError(409, 'category_in_use')
    const [row] = await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
      .returning({ id: categories.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })

  // ───────────── Товары ─────────────

  /** Категория и отдел должны принадлежать тому же заведению. */
  async function assertRefs(tenantId: string, categoryId?: string | null, departmentId?: string | null) {
    if (categoryId) {
      const [c] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
      if (!c) throw new HttpError(400, 'bad_category')
    }
    if (departmentId) {
      const [d] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId), isNull(departments.deletedAt)),
        )
      if (!d) throw new HttpError(400, 'bad_department')
    }
  }

  async function assertBarcodeFree(tenantId: string, barcode: string, exceptId?: string) {
    const cond = and(eq(products.tenantId, tenantId), eq(products.barcode, barcode), isNull(products.deletedAt))
    const [taken] = await db
      .select({ id: products.id })
      .from(products)
      .where(exceptId ? and(cond, ne(products.id, exceptId)) : cond)
    if (taken) throw new HttpError(409, 'barcode_taken')
  }

  app.get('/api/products', view, async (req) =>
    db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, req.auth.tenantId), isNull(products.deletedAt)))
      .orderBy(asc(products.sort), asc(products.createdAt)),
  )

  app.post('/api/products', edit, async (req) => {
    const body = productBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertRefs(tenantId, body.categoryId, body.departmentId)
    const barcode = body.barcode || null
    if (barcode) await assertBarcodeFree(tenantId, barcode)
    const [row] = await db
      .insert(products)
      .values({
        tenantId,
        ...body,
        barcode,
        categoryId: body.categoryId ?? null,
        departmentId: body.departmentId ?? null,
      })
      .returning()
    return row
  })

  app.patch('/api/products/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = productBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertRefs(tenantId, body.categoryId, body.departmentId)
    const barcode = body.barcode || null
    if (barcode) await assertBarcodeFree(tenantId, barcode, id)
    const [row] = await db
      .update(products)
      .set({
        ...body,
        barcode,
        categoryId: body.categoryId ?? null,
        departmentId: body.departmentId ?? null,
      })
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  /** Быстрые переключатели из списка: стоп-лист, активность, избранное. */
  app.post('/api/products/:id/flags', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({ stopped: z.boolean(), active: z.boolean(), favorite: z.boolean() })
      .partial()
      .refine((v) => Object.keys(v).length > 0)
      .parse(req.body)
    const [row] = await db
      .update(products)
      .set(body)
      .where(and(eq(products.id, id), eq(products.tenantId, req.auth.tenantId), isNull(products.deletedAt)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  // Мягкое удаление: товар остаётся в старых чеках и отчётах, штрих-код освобождается.
  app.delete('/api/products/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const [row] = await db
      .update(products)
      .set({ deletedAt: new Date(), active: false })
      .where(and(eq(products.id, id), eq(products.tenantId, req.auth.tenantId), isNull(products.deletedAt)))
      .returning({ id: products.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })
}

// ───────────── Залы и столы ─────────────

const hallBody = z.object({
  name: z.string().trim().min(1).max(60),
  sort: z.number().int().min(0).max(100000).default(0),
})

const tableBody = z.object({
  hallId: z.string().uuid(),
  name: z.string().trim().min(1).max(30),
  seats: z.number().int().min(1).max(100).default(4),
})

export function hallRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const edit = { preHandler: requirePerm('halls.edit') }
  const { halls, tables, branches, receipts } = schema

  async function defaultBranch(tenantId: string) {
    const [b] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.tenantId, tenantId))
      .orderBy(asc(branches.createdAt))
      .limit(1)
    if (!b) throw new HttpError(500, 'internal')
    return b.id
  }

  async function loadHall(tenantId: string, hallId: string) {
    const [h] = await db
      .select()
      .from(halls)
      .where(and(eq(halls.id, hallId), eq(halls.tenantId, tenantId), isNull(halls.deletedAt)))
    if (!h) throw new HttpError(404, 'not_found')
    return h
  }

  /** Нельзя убрать стол, за которым сейчас открыт чек. */
  async function assertNoOpenReceipts(tenantId: string, tableIds: string[]) {
    if (!tableIds.length) return
    const [{ n }] = await db
      .select({ n: count() })
      .from(receipts)
      .where(
        and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'open'), inArray(receipts.tableId, tableIds)),
      )
    if (n > 0) throw new HttpError(409, 'table_busy')
  }

  app.get('/api/halls', edit, async (req) => {
    const tenantId = req.auth.tenantId
    const hallRows = await db
      .select()
      .from(halls)
      .where(and(eq(halls.tenantId, tenantId), isNull(halls.deletedAt)))
      .orderBy(asc(halls.sort), asc(halls.name))
    const tableRows = await db
      .select()
      .from(tables)
      .where(and(eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
    // Столы сортируем «по-человечески»: 2 раньше 10.
    const collator = new Intl.Collator('ru', { numeric: true })
    tableRows.sort((a, b) => collator.compare(a.name, b.name))
    return hallRows.map((h) => ({ ...h, tables: tableRows.filter((t) => t.hallId === h.id) }))
  })

  app.post('/api/halls', edit, async (req) => {
    const body = hallBody.parse(req.body)
    const tenantId = req.auth.tenantId
    const [row] = await db
      .insert(halls)
      .values({ tenantId, branchId: await defaultBranch(tenantId), ...body })
      .returning()
    return { ...row, tables: [] }
  })

  app.patch('/api/halls/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = hallBody.parse(req.body)
    await loadHall(req.auth.tenantId, id)
    const [row] = await db.update(halls).set(body).where(eq(halls.id, id)).returning()
    return row
  })

  app.delete('/api/halls/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, id)
    const own = await db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.hallId, id), isNull(tables.deletedAt)))
    await assertNoOpenReceipts(tenantId, own.map((t) => t.id))
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx.update(tables).set({ deletedAt: now }).where(and(eq(tables.hallId, id), isNull(tables.deletedAt)))
      await tx.update(halls).set({ deletedAt: now }).where(eq(halls.id, id))
    })
    return { ok: true }
  })

  async function assertTableNameFree(hallId: string, names: string[], exceptId?: string) {
    const cond = and(eq(tables.hallId, hallId), inArray(tables.name, names), isNull(tables.deletedAt))
    const [taken] = await db
      .select({ name: tables.name })
      .from(tables)
      .where(exceptId ? and(cond, ne(tables.id, exceptId)) : cond)
    if (taken) throw new HttpError(409, 'table_name_taken')
  }

  app.post('/api/tables', edit, async (req) => {
    const body = tableBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, body.hallId)
    await assertTableNameFree(body.hallId, [body.name])
    const [row] = await db
      .insert(tables)
      .values({ tenantId, ...body })
      .returning()
    return row
  })

  /** Сразу несколько столов с номерами подряд: «с 1 по 12». */
  app.post('/api/tables/bulk', edit, async (req) => {
    const body = z
      .object({
        hallId: z.string().uuid(),
        from: z.number().int().min(1).max(9999),
        to: z.number().int().min(1).max(9999),
        seats: z.number().int().min(1).max(100).default(4),
      })
      .refine((v) => v.to >= v.from && v.to - v.from < 200, { message: 'bad_range' })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, body.hallId)
    const names = Array.from({ length: body.to - body.from + 1 }, (_, i) => String(body.from + i))
    await assertTableNameFree(body.hallId, names)
    const rows = await db
      .insert(tables)
      .values(names.map((name) => ({ tenantId, hallId: body.hallId, name, seats: body.seats })))
      .returning()
    return rows
  })

  app.patch('/api/tables/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = tableBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, body.hallId)
    await assertTableNameFree(body.hallId, [body.name], id)
    const [row] = await db
      .update(tables)
      .set(body)
      .where(and(eq(tables.id, id), eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  app.delete('/api/tables/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    await assertNoOpenReceipts(tenantId, [id])
    const [row] = await db
      .update(tables)
      .set({ deletedAt: new Date() })
      .where(and(eq(tables.id, id), eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
      .returning({ id: tables.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })
}
