import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  checkThrottle,
  clearThrottle,
  hashPin,
  HttpError,
  makeAuthGuards,
  noteFailure,
  verifyPassword,
} from '../auth.js'
import { schema, type DB } from '../db/index.js'

const idParam = z.object({ id: z.string().uuid() })
const itemParam = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
type Conn = DB | Tx

const {
  users,
  roles,
  tenants,
  branches,
  terminals,
  categories,
  products,
  halls,
  tables,
  saleTypes,
  paymentMethods,
  reasons,
  shifts,
  receipts,
  receiptItems,
  payments,
  auditLog,
} = schema

/** Настройки печати заведения с значениями по умолчанию. Хранятся в tenants.settings. */
export function printSettings(settings: Record<string, unknown>) {
  const str = (k: string) => (typeof settings[k] === 'string' ? (settings[k] as string) : '')
  const flag = (k: string) => (typeof settings[k] === 'boolean' ? (settings[k] as boolean) : true)
  return {
    address: str('address'),
    phone: str('phone'),
    footer: str('receiptFooter'),
    /** Печатать бегунок на кухню при отправке заказа */
    kitchen: flag('printKitchen'),
    /** Печатать чек гостю при закрытии */
    receipt: flag('printReceipt'),
  }
}

export function posRoutes(app: FastifyInstance, db: DB) {
  const { requirePos } = makeAuthGuards(db)
  const pos = { preHandler: requirePos }

  const can = (req: FastifyRequest, perm: string) => req.auth.role.permissions.includes(perm)
  const need = (req: FastifyRequest, perm: string) => {
    if (!can(req, perm)) throw new HttpError(403, 'no_permission')
  }

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

  // ───────────── Привязка устройства и вход по ПИН-коду ─────────────

  /**
   * Первый запуск кассы на устройстве: владелец или администратор вводит логин и пароль
   * от панели. Устройство получает долгий токен, который сам по себе даёт только право
   * спрашивать ПИН-код.
   */
  app.post('/api/pos/activate', async (req) => {
    const body = z
      .object({
        login: z.string().trim().toLowerCase().max(64),
        password: z.string().max(200),
        name: z.string().trim().min(1).max(60).default('Kassa'),
      })
      .parse(req.body)
    const key = `act:${req.ip}:${body.login}`
    checkThrottle(key)
    const [row] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.login, body.login))
    const ok = await verifyPassword(body.password, row?.user.passwordHash ?? null)
    if (!row || !ok || !row.user.active || row.user.deletedAt) {
      noteFailure(key)
      throw new HttpError(401, 'bad_credentials')
    }
    clearThrottle(key)
    if (!row.role.isOwner && !row.role.panelAccess) throw new HttpError(403, 'forbidden')

    const tenantId = row.user.tenantId
    const [terminal] = await db
      .insert(terminals)
      .values({
        tenantId,
        branchId: await defaultBranch(tenantId),
        name: body.name,
        code: crypto.randomUUID(),
      })
      .returning()
    const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
    return {
      deviceToken: app.jwt.sign({ kind: 'device', tid: tenantId, did: terminal.id }, { expiresIn: '3650d' }),
      venue: tenant.name,
    }
  })

  app.post('/api/pos/pin', async (req) => {
    const { pin } = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).parse(req.body)
    let device: { kind?: string; tid: string; did?: string }
    try {
      device = app.jwt.verify(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    } catch {
      throw new HttpError(401, 'device_not_activated')
    }
    if (device.kind !== 'device' || !device.did) throw new HttpError(401, 'device_not_activated')
    const [terminal] = await db
      .select()
      .from(terminals)
      .where(and(eq(terminals.id, device.did), eq(terminals.tenantId, device.tid)))
    if (!terminal || !terminal.active) throw new HttpError(401, 'device_not_activated')

    // ПИН короткий, поэтому перебор ограничиваем на само устройство.
    const key = `pin:${terminal.id}`
    checkThrottle(key)
    const [row] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(
        and(
          eq(users.tenantId, device.tid),
          eq(users.pinHash, hashPin(device.tid, pin)),
          eq(users.active, true),
          isNull(users.deletedAt),
        ),
      )
    if (!row || !(row.role.isOwner || row.role.terminalAccess)) {
      noteFailure(key)
      throw new HttpError(401, 'bad_pin')
    }
    clearThrottle(key)
    await db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, terminal.id))
    return {
      token: app.jwt.sign({ sub: row.user.id, tid: device.tid, did: terminal.id }, { expiresIn: '16h' }),
    }
  })

  // ───────────── Справочники для кассы ─────────────

  async function openShift(conn: Conn, tenantId: string) {
    const [s] = await conn
      .select()
      .from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), isNull(shifts.closedAt)))
      .orderBy(desc(shifts.openedAt))
      .limit(1)
    return s ?? null
  }

  app.get('/api/pos/bootstrap', pos, async (req) => {
    const tenantId = req.auth.tenantId
    const live = <T extends { tenantId: unknown; deletedAt: unknown }>(t: T) =>
      and(eq(t.tenantId as never, tenantId), isNull(t.deletedAt as never))
    const [tenant] = await db
      .select({ name: tenants.name, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    const deps = await db
      .select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departments)
      .where(live(schema.departments))
    const [cats, prods, hallRows, tableRows, sales, methods, reasonRows] = await Promise.all([
      db.select().from(categories).where(and(live(categories), eq(categories.active, true))).orderBy(asc(categories.sort), asc(categories.createdAt)),
      db.select().from(products).where(and(live(products), eq(products.active, true))).orderBy(asc(products.sort), asc(products.createdAt)),
      db.select().from(halls).where(live(halls)).orderBy(asc(halls.sort), asc(halls.name)),
      db.select().from(tables).where(live(tables)),
      db.select().from(saleTypes).where(and(eq(saleTypes.tenantId, tenantId), eq(saleTypes.active, true))).orderBy(asc(saleTypes.sort)),
      db.select().from(paymentMethods).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.active, true))).orderBy(asc(paymentMethods.sort)),
      db.select().from(reasons).where(and(eq(reasons.tenantId, tenantId), eq(reasons.active, true))),
    ])
    const collator = new Intl.Collator('ru', { numeric: true })
    tableRows.sort((a, b) => collator.compare(a.name, b.name))
    return {
      venue: tenant.name,
      print: printSettings(tenant.settings),
      departments: deps,
      user: req.auth,
      shift: await openShift(db, tenantId),
      categories: cats.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      products: prods.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        categoryId: p.categoryId,
        favorite: p.favorite,
        stopped: p.stopped,
      })),
      halls: hallRows.map((h) => ({
        id: h.id,
        name: h.name,
        tables: tableRows.filter((t) => t.hallId === h.id).map((t) => ({ id: t.id, name: t.name, seats: t.seats })),
      })),
      saleTypes: sales.map((s) => ({ id: s.id, kind: s.kind, name: s.name, serviceBp: s.serviceBp })),
      paymentMethods: methods.map((m) => ({ id: m.id, kind: m.kind, name: m.name })),
      reasons: reasonRows.map((r) => ({ id: r.id, kind: r.kind, name: r.name })),
    }
  })

  // ───────────── Кассовая смена ─────────────

  async function shiftSummary(conn: Conn, shift: typeof shifts.$inferSelect) {
    const closed = await conn
      .select({ id: receipts.id, total: receipts.total })
      .from(receipts)
      .where(and(eq(receipts.shiftId, shift.id), eq(receipts.status, 'closed')))
    const byMethod = await conn
      .select({
        methodId: payments.methodId,
        kind: paymentMethods.kind,
        name: paymentMethods.name,
        amount: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(receipts, eq(receipts.id, payments.receiptId))
      .innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId))
      .where(and(eq(receipts.shiftId, shift.id), eq(receipts.status, 'closed')))
      .groupBy(payments.methodId, paymentMethods.kind, paymentMethods.name)
    const [{ n: openCount }] = await conn
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(receipts)
      .where(and(eq(receipts.shiftId, shift.id), eq(receipts.status, 'open')))
    const cash = byMethod.filter((m) => m.kind === 'cash').reduce((s, m) => s + m.amount, 0)
    return {
      receipts: closed.length,
      revenue: closed.reduce((s, r) => s + r.total, 0),
      byMethod,
      openReceipts: openCount,
      expectedCash: shift.openingCash + cash,
    }
  }

  app.get('/api/pos/shift', pos, async (req) => {
    const shift = await openShift(db, req.auth.tenantId)
    return { shift, summary: shift ? await shiftSummary(db, shift) : null }
  })

  app.post('/api/pos/shift/open', pos, async (req) => {
    need(req, 'shift.open_close')
    const { openingCash } = z.object({ openingCash: z.number().int().min(0).max(1e12) }).parse(req.body)
    const tenantId = req.auth.tenantId
    // Читаем до транзакции: внутри неё все запросы должны идти через tx, иначе
    // встроенная база (одно соединение) будет ждать саму себя.
    const branchId = await defaultBranch(tenantId)
    return db.transaction(async (tx) => {
      if (await openShift(tx, tenantId)) throw new HttpError(409, 'shift_already_open')
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${shifts.number}), 0)::int`.mapWith(Number) })
        .from(shifts)
        .where(eq(shifts.tenantId, tenantId))
      const [shift] = await tx
        .insert(shifts)
        .values({
          tenantId,
          branchId,
          number: max + 1,
          openedBy: req.auth.userId,
          openingCash,
        })
        .returning()
      await tx.insert(auditLog).values({ tenantId, userId: req.auth.userId, action: 'shift.open', data: { number: shift.number, openingCash } })
      return shift
    })
  })

  app.post('/api/pos/shift/close', pos, async (req) => {
    need(req, 'shift.open_close')
    const { countedCash } = z.object({ countedCash: z.number().int().min(0).max(1e12) }).parse(req.body)
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const shift = await openShift(tx, tenantId)
      if (!shift) throw new HttpError(409, 'shift_closed')
      const summary = await shiftSummary(tx, shift)
      if (summary.openReceipts > 0) throw new HttpError(409, 'open_receipts')
      const [closed] = await tx
        .update(shifts)
        .set({ closedAt: new Date(), closedBy: req.auth.userId, expectedCash: summary.expectedCash, countedCash })
        .where(eq(shifts.id, shift.id))
        .returning()
      await tx.insert(auditLog).values({
        tenantId,
        userId: req.auth.userId,
        action: 'shift.close',
        suspicious: countedCash !== summary.expectedCash,
        data: { number: shift.number, expectedCash: summary.expectedCash, countedCash },
      })
      return { shift: closed, summary }
    })
  })

  // ───────────── Чеки ─────────────

  /** Пересчитывает суммы чека по позициям. Вызывается после каждого изменения. */
  async function recalc(tx: Tx, receiptId: string) {
    const [r] = await tx.select().from(receipts).where(eq(receipts.id, receiptId))
    const items = await tx
      .select({ total: receiptItems.total })
      .from(receiptItems)
      .where(and(eq(receiptItems.receiptId, receiptId), isNull(receiptItems.voidedAt), eq(receiptItems.comp, false)))
    const subtotal = items.reduce((s, i) => s + i.total, 0)
    let discountAmount = 0
    if (r.discountKind === 'percent') discountAmount = Math.round((subtotal * r.discountValue) / 100)
    else if (r.discountKind === 'amount') discountAmount = Math.min(r.discountValue, subtotal)
    const base = subtotal - discountAmount
    const serviceAmount = Math.round((base * r.serviceBp) / 10000)
    await tx
      .update(receipts)
      .set({ subtotal, discountAmount, serviceAmount, total: base + serviceAmount, version: r.version + 1 })
      .where(eq(receipts.id, receiptId))
  }

  async function fullReceipt(conn: Conn, tenantId: string, receiptId: string) {
    const [row] = await conn
      .select({ r: receipts, tableName: tables.name, waiterName: users.name })
      .from(receipts)
      .leftJoin(tables, eq(tables.id, receipts.tableId))
      .leftJoin(users, eq(users.id, receipts.waiterId))
      .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, tenantId)))
    if (!row) throw new HttpError(404, 'not_found')
    const items = await conn
      .select()
      .from(receiptItems)
      .where(eq(receiptItems.receiptId, receiptId))
      .orderBy(asc(receiptItems.createdAt))
    const paid = await conn
      .select({ name: paymentMethods.name, kind: paymentMethods.kind, amount: payments.amount })
      .from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId))
      .where(eq(payments.receiptId, receiptId))
      .orderBy(asc(payments.createdAt))
    return {
      ...row.r,
      tableName: row.tableName,
      waiterName: row.waiterName,
      payments: paid,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        departmentId: i.departmentId,
        name: i.name,
        price: i.price,
        qty: i.qty,
        total: i.total,
        comment: i.comment,
        sent: i.sentAt != null,
        voided: i.voidedAt != null,
      })),
    }
  }

  /** Загружает открытый чек и проверяет, что сотрудник вправе с ним работать. */
  async function loadOpen(conn: Conn, req: FastifyRequest, receiptId: string) {
    const [r] = await conn
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, req.auth.tenantId)))
    if (!r) throw new HttpError(404, 'not_found')
    if (r.waiterId !== req.auth.userId && !can(req, 'receipt.see_all')) throw new HttpError(403, 'no_permission')
    if (r.status !== 'open') throw new HttpError(409, 'receipt_closed')
    return r
  }

  const log = (tx: Tx, req: FastifyRequest, receiptId: string, action: string, data: Record<string, unknown> = {}, suspicious = false) =>
    tx.insert(auditLog).values({ tenantId: req.auth.tenantId, userId: req.auth.userId, receiptId, action, data, suspicious })

  app.get('/api/pos/receipts', pos, async (req) => {
    const tenantId = req.auth.tenantId
    const mine = can(req, 'receipt.see_all') ? undefined : eq(receipts.waiterId, req.auth.userId)
    const rows = await db
      .select({
        id: receipts.id,
        number: receipts.number,
        tableId: receipts.tableId,
        tableName: tables.name,
        saleTypeId: receipts.saleTypeId,
        waiterId: receipts.waiterId,
        waiterName: users.name,
        total: receipts.total,
        billPrinted: receipts.billPrinted,
        openedAt: receipts.openedAt,
      })
      .from(receipts)
      .leftJoin(tables, eq(tables.id, receipts.tableId))
      .leftJoin(users, eq(users.id, receipts.waiterId))
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'open'), mine))
      .orderBy(asc(receipts.openedAt))
    // Занятые столы показываем всем, даже если чек чужой: иначе за стол сядут дважды.
    const busy = await db
      .select({ tableId: receipts.tableId })
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'open')))
    return { receipts: rows, busyTables: busy.map((b) => b.tableId).filter(Boolean) }
  })

  app.post('/api/pos/receipts', pos, async (req) => {
    const body = z
      .object({
        tableId: z.string().uuid().nullish(),
        saleTypeId: z.string().uuid().nullish(),
        guests: z.number().int().min(1).max(200).default(1),
      })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const shift = await openShift(tx, tenantId)
      if (!shift) throw new HttpError(409, 'shift_closed')

      if (body.tableId) {
        const [t] = await tx
          .select({ id: tables.id })
          .from(tables)
          .where(and(eq(tables.id, body.tableId), eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
        if (!t) throw new HttpError(400, 'bad_table')
        // Если за столом уже открыт чек — возвращаем его, а не создаём второй.
        const [existing] = await tx
          .select({ id: receipts.id, waiterId: receipts.waiterId })
          .from(receipts)
          .where(and(eq(receipts.tenantId, tenantId), eq(receipts.tableId, body.tableId), eq(receipts.status, 'open')))
        if (existing) {
          if (existing.waiterId !== req.auth.userId && !can(req, 'receipt.see_all')) throw new HttpError(403, 'table_taken')
          return fullReceipt(tx, tenantId, existing.id)
        }
      }

      const types = await tx.select().from(saleTypes).where(and(eq(saleTypes.tenantId, tenantId), eq(saleTypes.active, true))).orderBy(asc(saleTypes.sort))
      const type = body.saleTypeId
        ? types.find((s) => s.id === body.saleTypeId)
        : types.find((s) => s.kind === (body.tableId ? 'hall' : 'takeaway')) ?? types[0]
      if (!type) throw new HttpError(400, 'bad_sale_type')

      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${receipts.number}), 0)::int`.mapWith(Number) })
        .from(receipts)
        .where(eq(receipts.tenantId, tenantId))
      const [r] = await tx
        .insert(receipts)
        .values({
          tenantId,
          branchId: shift.branchId,
          shiftId: shift.id,
          number: max + 1,
          saleTypeId: type.id,
          tableId: body.tableId ?? null,
          waiterId: req.auth.userId,
          guests: body.guests,
          serviceBp: type.serviceBp,
        })
        .returning()
      await log(tx, req, r.id, 'receipt.open', { number: r.number })
      return fullReceipt(tx, tenantId, r.id)
    })
  })

  app.get('/api/pos/receipts/:id', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const r = await fullReceipt(db, req.auth.tenantId, id)
    if (r.waiterId !== req.auth.userId && !can(req, 'receipt.see_all')) throw new HttpError(403, 'no_permission')
    return r
  })

  app.patch('/api/pos/receipts/:id', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({ guests: z.number().int().min(1).max(200), comment: z.string().trim().max(300).nullable() })
      .partial()
      .parse(req.body)
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      await tx.update(receipts).set(body).where(eq(receipts.id, id))
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  // Пустой чек (ничего не отправлено на кухню) можно просто отменить.
  app.delete('/api/pos/receipts/:id', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const sent = await tx
        .select({ id: receiptItems.id })
        .from(receiptItems)
        .where(and(eq(receiptItems.receiptId, id), sql`${receiptItems.sentAt} is not null`))
        .limit(1)
      if (sent.length) throw new HttpError(409, 'receipt_has_sent_items')
      await tx.delete(receiptItems).where(eq(receiptItems.receiptId, id))
      await tx.update(receipts).set({ status: 'cancelled', closedAt: new Date(), subtotal: 0, total: 0, serviceAmount: 0, discountAmount: 0 }).where(eq(receipts.id, id))
      await log(tx, req, id, 'receipt.cancel')
      return { ok: true }
    })
  })

  // ───── Позиции ─────

  app.post('/api/pos/receipts/:id/items', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(1_000_000).default(1000) })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const [p] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, body.productId), eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      if (!p || !p.active) throw new HttpError(400, 'bad_product')
      if (p.stopped) throw new HttpError(409, 'product_stopped')

      // Ещё не отправленная строка с тем же товаром — просто увеличиваем количество.
      const [same] = await tx
        .select()
        .from(receiptItems)
        .where(
          and(
            eq(receiptItems.receiptId, id),
            eq(receiptItems.productId, p.id),
            isNull(receiptItems.sentAt),
            isNull(receiptItems.voidedAt),
            eq(receiptItems.price, p.price),
          ),
        )
      if (same) {
        const qty = same.qty + body.qty
        await tx.update(receiptItems).set({ qty, total: Math.round((p.price * qty) / 1000) }).where(eq(receiptItems.id, same.id))
      } else {
        await tx.insert(receiptItems).values({
          tenantId,
          receiptId: id,
          productId: p.id,
          name: p.name,
          departmentId: p.departmentId,
          price: p.price,
          qty: body.qty,
          total: Math.round((p.price * body.qty) / 1000),
          addedBy: req.auth.userId,
        })
      }
      await recalc(tx, id)
      return fullReceipt(tx, tenantId, id)
    })
  })

  /** Изменить количество или комментарий у ещё не отправленной позиции; 0 — убрать её. */
  app.patch('/api/pos/receipts/:id/items/:itemId', pos, async (req) => {
    const { id, itemId } = itemParam.parse(req.params)
    const body = z
      .object({ qty: z.number().int().min(0).max(1_000_000), comment: z.string().trim().max(200).nullable() })
      .partial()
      .parse(req.body)
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const [item] = await tx.select().from(receiptItems).where(and(eq(receiptItems.id, itemId), eq(receiptItems.receiptId, id)))
      if (!item || item.voidedAt) throw new HttpError(404, 'not_found')
      if (item.sentAt) throw new HttpError(409, 'item_already_sent')
      if (body.qty === 0) {
        await tx.delete(receiptItems).where(eq(receiptItems.id, itemId))
      } else {
        const qty = body.qty ?? item.qty
        await tx
          .update(receiptItems)
          .set({ qty, total: Math.round((item.price * qty) / 1000), ...(body.comment !== undefined ? { comment: body.comment } : {}) })
          .where(eq(receiptItems.id, itemId))
      }
      await recalc(tx, id)
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  /** Удалить позицию, уже отправленную на кухню: нужно право и причина. */
  app.post('/api/pos/receipts/:id/items/:itemId/void', pos, async (req) => {
    const { id, itemId } = itemParam.parse(req.params)
    const { reasonId } = z.object({ reasonId: z.string().uuid() }).parse(req.body)
    need(req, 'receipt.void_sent_item')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const [item] = await tx.select().from(receiptItems).where(and(eq(receiptItems.id, itemId), eq(receiptItems.receiptId, id)))
      if (!item || item.voidedAt) throw new HttpError(404, 'not_found')
      const [reason] = await tx.select().from(reasons).where(and(eq(reasons.id, reasonId), eq(reasons.tenantId, tenantId), eq(reasons.kind, 'void')))
      if (!reason) throw new HttpError(400, 'bad_reason')
      await tx.update(receiptItems).set({ voidedAt: new Date(), voidedBy: req.auth.userId, reasonId }).where(eq(receiptItems.id, itemId))
      await tx.update(receipts).set({ suspicious: true }).where(eq(receipts.id, id))
      await log(tx, req, id, 'item.void', { name: item.name, qty: item.qty, total: item.total, reason: reason.name }, true)
      await recalc(tx, id)
      return fullReceipt(tx, tenantId, id)
    })
  })

  app.post('/api/pos/receipts/:id/send', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const sent = await tx
        .update(receiptItems)
        .set({ sentAt: new Date() })
        .where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.sentAt), isNull(receiptItems.voidedAt)))
        .returning({ id: receiptItems.id, name: receiptItems.name, qty: receiptItems.qty, departmentId: receiptItems.departmentId, comment: receiptItems.comment })
      if (sent.length) await log(tx, req, id, 'receipt.send', { items: sent.length })
      return { receipt: await fullReceipt(tx, req.auth.tenantId, id), sent }
    })
  })

  /** Гостю распечатан счёт (предчек): отмечаем это, стол в зале меняет цвет. */
  app.post('/api/pos/receipts/:id/bill', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    return db.transaction(async (tx) => {
      const r = await loadOpen(tx, req, id)
      // Вместе со счётом уходит на кухню всё, что ещё не отправлено: гость платит за то, что в счёте.
      const sent = await tx
        .update(receiptItems)
        .set({ sentAt: new Date() })
        .where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.sentAt), isNull(receiptItems.voidedAt)))
        .returning({ id: receiptItems.id })
      await tx.update(receipts).set({ billPrinted: true }).where(eq(receipts.id, id))
      await log(tx, req, id, 'receipt.bill', { total: r.total, reprint: r.billPrinted })
      return { receipt: await fullReceipt(tx, req.auth.tenantId, id), sentIds: sent.map((s) => s.id) }
    })
  })

  app.post('/api/pos/receipts/:id/discount', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('percent'), value: z.number().int().min(1).max(100) }),
        z.object({ kind: z.literal('amount'), value: z.number().int().min(1).max(1e12) }),
        z.object({ kind: z.literal('none') }),
      ])
      .parse(req.body)
    need(req, 'receipt.discount')
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const patch = body.kind === 'none' ? { discountKind: null, discountValue: 0 } : { discountKind: body.kind, discountValue: body.value }
      await tx.update(receipts).set(patch).where(eq(receipts.id, id))
      await log(tx, req, id, 'receipt.discount', body, body.kind === 'percent' && body.value >= 20)
      await recalc(tx, id)
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  // ───── Оплата ─────

  app.post('/api/pos/receipts/:id/pay', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({
        payments: z
          .array(z.object({ methodId: z.string().uuid(), amount: z.number().int().min(1).max(1e12) }))
          .min(1)
          .max(10),
      })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r0 = await loadOpen(tx, req, id)
      // Всё, что не успели отправить на кухню, отправляется вместе с оплатой.
      await tx.update(receiptItems).set({ sentAt: new Date() }).where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.sentAt), isNull(receiptItems.voidedAt)))
      await recalc(tx, id)
      const [r] = await tx.select().from(receipts).where(eq(receipts.id, id))
      const live = await tx.select({ id: receiptItems.id }).from(receiptItems).where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.voidedAt))).limit(1)
      if (!live.length) throw new HttpError(409, 'receipt_empty')

      const methods = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.tenantId, tenantId), inArray(paymentMethods.id, body.payments.map((p) => p.methodId))))
      const kindOf = new Map(methods.map((m) => [m.id, m.kind]))
      if (body.payments.some((p) => !kindOf.has(p.methodId))) throw new HttpError(400, 'bad_method')

      const paid = body.payments.reduce((s, p) => s + p.amount, 0)
      if (paid < r.total) throw new HttpError(409, 'not_enough_paid')
      const change = paid - r.total
      const cashPaid = body.payments.filter((p) => kindOf.get(p.methodId) === 'cash').reduce((s, p) => s + p.amount, 0)
      // Сдачу можно дать только с наличных: картой нельзя заплатить больше суммы чека.
      if (change > cashPaid) throw new HttpError(409, 'overpaid_non_cash')

      // В базу пишем то, что реально осталось в кассе: наличные за вычетом сдачи.
      let left = change
      const rows = body.payments
        .map((p) => {
          let amount = p.amount
          if (left > 0 && kindOf.get(p.methodId) === 'cash') {
            const cut = Math.min(left, amount)
            amount -= cut
            left -= cut
          }
          return { tenantId, receiptId: id, methodId: p.methodId, amount, userId: req.auth.userId }
        })
        .filter((p) => p.amount > 0)
      if (rows.length) await tx.insert(payments).values(rows)
      await tx.update(receipts).set({ status: 'closed', closedAt: new Date() }).where(eq(receipts.id, id))
      await log(tx, req, id, 'receipt.pay', { total: r.total, paid, change, number: r0.number })
      return { receipt: await fullReceipt(tx, tenantId, id), change }
    })
  })
}
