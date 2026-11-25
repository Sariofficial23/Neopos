import { and, asc, count, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
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
  /** Себестоимость единицы; 0 — не указана */
  cost: z.number().int().min(0).max(1_000_000_000).default(0),
  barcode: z.string().trim().max(64).nullish(),
  unit: z.enum(['pcs', 'kg', 'l']).default('pcs'),
  byWeight: z.boolean().default(false),
  favorite: z.boolean().default(false),
  stopped: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(100000).default(0),
})

export function menuRoutes(app: FastifyInstance, db: DB) {
  const { requireAuth } = makeAuthGuards(db)
  /**
   * Меню правят и из панели, и прямо на кассе (кнопка ⚙ над плитками меню).
   * Нужен вход в панель или в кассу и право на действие; на кассе для просмотра тоже нужно право правки.
   */
  const allow = (perms: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply)
    const role = req.auth.role
    const ok = role.panelAccess
      ? perms.some((p) => role.permissions.includes(p))
      : role.terminalAccess && role.permissions.includes('menu.edit')
    if (!ok) throw new HttpError(403, 'forbidden')
  }
  const view = { preHandler: allow(['menu.view', 'menu.edit']) }
  const edit = { preHandler: allow(['menu.edit']) }
  const { departments, categories, products, itemMedia } = schema

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

  // ?deleted=1 — вкладка «Удалено»: товары, убранные из меню, их можно вернуть.
  app.get('/api/products', view, async (req) => {
    const deleted = (req.query as { deleted?: string }).deleted === '1'
    return db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, req.auth.tenantId), deleted ? isNotNull(products.deletedAt) : isNull(products.deletedAt)))
      .orderBy(asc(products.sort), asc(products.createdAt))
  })

  /** Вернуть удалённый товар в меню. Возвращается выключенным — владелец сам включит продажу. */
  app.post('/api/products/:id/restore', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const [old] = await db.select().from(products).where(and(eq(products.id, id), eq(products.tenantId, tenantId), isNotNull(products.deletedAt)))
    if (!old) throw new HttpError(404, 'not_found')
    // Штрих-код за это время мог занять другой товар.
    if (old.barcode) await assertBarcodeFree(tenantId, old.barcode, id)
    const [row] = await db.update(products).set({ deletedAt: null, active: false }).where(eq(products.id, id)).returning()
    return row
  })

  // ───────────── Фото товаров и категорий ─────────────

  const imageBody = z.object({ image: z.string().regex(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'bad_image') })
  const MAX_IMAGE_BYTES = 200_000

  for (const [path, table] of [
    ['products', products],
    ['categories', categories],
  ] as const) {
    const owned = async (req: FastifyRequest, id: string) => {
      const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.tenantId, req.auth.tenantId), isNull(table.deletedAt)))
      if (!row) throw new HttpError(404, 'not_found')
    }
    // Картинку сжимает панель; здесь только проверяем тип и размер.
    app.put(`/api/${path}/:id/image`, { ...edit, bodyLimit: 600_000 }, async (req) => {
      const { id } = idParam.parse(req.params)
      const { image } = imageBody.parse(req.body)
      await owned(req, id)
      const [, mime, data] = /^data:(image\/[a-z]+);base64,(.*)$/.exec(image)!
      if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_big')
      const now = new Date()
      await db
        .insert(itemMedia)
        .values({ tenantId: req.auth.tenantId, refId: id, mime, data, updatedAt: now })
        .onConflictDoUpdate({ target: itemMedia.refId, set: { mime, data, updatedAt: now } })
      // В адресе — время изменения: касса держит картинку в кэше, а после замены берёт новую.
      const url = `/api/media/item/${id}?v=${now.getTime()}`
      await db.update(table).set({ image: url }).where(eq(table.id, id))
      return { image: url }
    })
    app.delete(`/api/${path}/:id/image`, edit, async (req) => {
      const { id } = idParam.parse(req.params)
      await owned(req, id)
      await db.delete(itemMedia).where(and(eq(itemMedia.refId, id), eq(itemMedia.tenantId, req.auth.tenantId)))
      await db.update(table).set({ image: null }).where(eq(table.id, id))
      return { image: null }
    })
  }

  // Сама картинка открыта без входа (в адресе случайный id), кэшируется надолго — адрес меняется при замене.
  app.get('/api/media/item/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const [row] = await db.select({ mime: itemMedia.mime, data: itemMedia.data }).from(itemMedia).where(eq(itemMedia.refId, id))
    if (!row) throw new HttpError(404, 'not_found')
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(Buffer.from(row.data, 'base64'))
  })

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
  /** Плата за обслуживание в зале: 0–100; null — «по умолчанию» (как у способа продажи). */
  servicePercent: z.number().min(0).max(100).nullish(),
  /** Прежний способ: проставить процент каждому столу зала. Оставлен для старых версий панели. */
  servicePercentForAll: z.number().min(0).max(100).nullish(),
})

/** Место стола на плане зала: клетки сетки 24 × 40, размер и форма. */
const placeBody = {
  x: z.number().int().min(0).max(23),
  y: z.number().int().min(0).max(39),
  w: z.number().int().min(1).max(8),
  h: z.number().int().min(1).max(8),
  shape: z.enum(['rect', 'round']),
}

const tableBody = z.object({
  hallId: z.string().uuid(),
  name: z.string().trim().min(1).max(30),
  seats: z.number().int().min(1).max(100).default(4),
  /** Процент обслуживания для стола: 0–100, можно с десятыми. */
  servicePercent: z.number().min(0).max(100).nullish(),
  x: placeBody.x.optional(),
  y: placeBody.y.optional(),
  w: placeBody.w.optional(),
  h: placeBody.h.optional(),
  shape: placeBody.shape.optional(),
})

/** Проценты в сотые доли процента; пусто — брать из способа продажи. */
const toBp = (percent: number | null | undefined) => (percent == null ? null : Math.round(percent * 100))

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
    const { servicePercentForAll: _unused, servicePercent, ...body } = hallBody.parse(req.body)
    const tenantId = req.auth.tenantId
    // Новый зал встаёт в конец списка.
    const [{ n }] = await db.select({ n: count() }).from(halls).where(and(eq(halls.tenantId, tenantId), isNull(halls.deletedAt)))
    const [row] = await db
      .insert(halls)
      .values({ tenantId, branchId: await defaultBranch(tenantId), ...body, sort: body.sort || n, serviceBp: toBp(servicePercent) })
      .returning()
    return { ...row, tables: [] }
  })

  app.patch('/api/halls/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const raw = req.body as Record<string, unknown> | null
    const { servicePercentForAll, servicePercent, sort, ...body } = hallBody.parse(req.body)
    await loadHall(req.auth.tenantId, id)
    const [row] = await db
      .update(halls)
      .set({
        ...body,
        // Порядок и процент меняем, только если их прислали: старая панель о них не знает.
        ...(raw && 'sort' in raw ? { sort } : {}),
        ...(raw && 'servicePercent' in raw ? { serviceBp: toBp(servicePercent) } : {}),
      })
      .where(eq(halls.id, id))
      .returning()
    if (servicePercentForAll != null) {
      await db
        .update(tables)
        .set({ serviceBp: toBp(servicePercentForAll) })
        .where(and(eq(tables.hallId, id), isNull(tables.deletedAt)))
    }
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

  /** «Настроить порядок залов»: залы идут на кассе в присланном порядке. */
  app.post('/api/halls/order', edit, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body)
    const tenantId = req.auth.tenantId
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(halls).set({ sort: i }).where(and(eq(halls.id, id), eq(halls.tenantId, tenantId)))
    })
    return { ok: true }
  })

  /** План зала: сохраняет место, размер и форму сразу всех столов. */
  app.put('/api/halls/:id/layout', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const { tables: list } = z.object({ tables: z.array(z.object({ id: z.string().uuid(), ...placeBody })).max(500) }).parse(req.body)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, id)
    await db.transaction(async (tx) => {
      for (const { id: tableId, ...place } of list) {
        await tx.update(tables).set(place).where(and(eq(tables.id, tableId), eq(tables.hallId, id), eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
      }
    })
    return { ok: true, saved: list.length }
  })

  /** «Очистить столы»: убирает все столы зала. Нельзя, пока за каким-то из них открыт чек. */
  app.delete('/api/halls/:id/tables', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, id)
    const own = await db.select({ id: tables.id }).from(tables).where(and(eq(tables.hallId, id), isNull(tables.deletedAt)))
    await assertNoOpenReceipts(tenantId, own.map((t) => t.id))
    await db.update(tables).set({ deletedAt: new Date() }).where(and(eq(tables.hallId, id), isNull(tables.deletedAt)))
    return { ok: true, removed: own.length }
  })

  /** Свободные места на плане для новых столов: размер 2 × 2, по восемь в ряд, как в Clopos. */
  async function freePlaces(hallId: string, howMany: number) {
    const taken = await db.select({ x: tables.x, y: tables.y, w: tables.w, h: tables.h }).from(tables).where(and(eq(tables.hallId, hallId), isNull(tables.deletedAt)))
    const busy = (x: number, y: number) => taken.some((t) => x < t.x + t.w && x + 2 > t.x && y < t.y + t.h && y + 2 > t.y)
    const out: { x: number; y: number; w: number; h: number }[] = []
    for (let row = 0; row < 13 && out.length < howMany; row++) {
      for (let col = 0; col < 8 && out.length < howMany; col++) {
        const x = col * 3
        const y = row * 3
        if (busy(x, y)) continue
        out.push({ x, y, w: 2, h: 2 })
        taken.push({ x, y, w: 2, h: 2 })
      }
    }
    // План заполнен — остальные встают в последнюю клетку, владелец расставит сам.
    while (out.length < howMany) out.push({ x: 21, y: 38, w: 2, h: 2 })
    return out
  }

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
    const { servicePercent, ...rest } = body
    const [place] = await freePlaces(body.hallId, 1)
    const [row] = await db
      .insert(tables)
      .values({ tenantId, ...place, ...rest, serviceBp: toBp(servicePercent) })
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
        servicePercent: z.number().min(0).max(100).nullish(),
      })
      .refine((v) => v.to >= v.from && v.to - v.from < 200, { message: 'bad_range' })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, body.hallId)
    const names = Array.from({ length: body.to - body.from + 1 }, (_, i) => String(body.from + i))
    await assertTableNameFree(body.hallId, names)
    const places = await freePlaces(body.hallId, names.length)
    const rows = await db
      .insert(tables)
      .values(names.map((name, i) => ({ tenantId, hallId: body.hallId, name, seats: body.seats, serviceBp: toBp(body.servicePercent), ...places[i] })))
      .returning()
    return rows
  })

  app.patch('/api/tables/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = tableBody.parse(req.body)
    const tenantId = req.auth.tenantId
    await loadHall(tenantId, body.hallId)
    await assertTableNameFree(body.hallId, [body.name], id)
    const { servicePercent, ...rest } = body
    const [row] = await db
      .update(tables)
      .set({ ...rest, serviceBp: toBp(servicePercent) })
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
