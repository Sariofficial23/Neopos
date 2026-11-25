import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  checkThrottle,
  clearThrottle,
  hashPin,
  legacyHashPin,
  HttpError,
  makeAuthGuards,
  noteFailure,
  verifyPassword,
} from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { brandImages } from './brand.js'
import { adjustStockForReceipt } from './supplies.js'
import { autoLogoutOf, dayStartOf } from './settings.js'
import { numberBase } from './sync.js'
import { listPrinters } from './finance.js'

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
  cashMovements,
} = schema

/** Настройки печати заведения с значениями по умолчанию. Хранятся в tenants.settings. */
export function printSettings(settings: Record<string, unknown>) {
  const str = (k: string) => (typeof settings[k] === 'string' ? (settings[k] as string) : '')
  const flag = (k: string) => (typeof settings[k] === 'boolean' ? (settings[k] as boolean) : true)
  return {
    address: str('address'),
    phone: str('phone'),
    /** Дополнительная строка под названием заведения */
    header: str('receiptHeader'),
    footer: str('receiptFooter'),
    showWaiter: flag('receiptShowWaiter'),
    showGuests: flag('receiptShowGuests'),
    showTime: flag('receiptShowTime'),
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
    // Основной способ: бренд (логин владельца) и пароль терминала, заданный в панели в разделе «Терминалы».
    const byTerminal = z
      .object({ brand: z.string().trim().toLowerCase().min(1).max(64), password: z.string().trim().min(1).max(32) })
      .safeParse(req.body)
    if (byTerminal.success) {
      const { brand, password } = byTerminal.data
      const key = `term:${req.ip}:${brand}`
      checkThrottle(key)
      const [owner] = await db
        .select({ tenantId: users.tenantId })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.login, brand), eq(roles.isOwner, true)))
      const [terminal] = owner
        ? await db
            .select()
            .from(terminals)
            .where(and(eq(terminals.tenantId, owner.tenantId), eq(terminals.password, password)))
        : []
      // Один ответ и на неверный бренд, и на неверный пароль: не подсказываем, что из двух не так.
      if (!owner || !terminal) {
        noteFailure(key)
        throw new HttpError(401, 'bad_terminal')
      }
      clearThrottle(key)
      if (!terminal.active) throw new HttpError(403, 'terminal_disabled')
      const [tenant] = await db.select({ name: tenants.name, blocked: tenants.blocked }).from(tenants).where(eq(tenants.id, owner.tenantId))
      if (!tenant || tenant.blocked) throw new HttpError(403, 'venue_blocked')
      await db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, terminal.id))
      return {
        deviceToken: app.jwt.sign({ kind: 'device', tid: owner.tenantId, did: terminal.id }, { expiresIn: '3650d' }),
        venue: tenant.name,
        terminal: terminal.name,
      }
    }

    // Прежний способ (логин и пароль от панели) оставлен для уже выпущенных версий кассы.
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
    const [owner] = await db.select({ blocked: tenants.blocked }).from(tenants).where(eq(tenants.id, tenantId))
    if (owner?.blocked) throw new HttpError(403, 'venue_blocked')
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
    const [venue] = await db.select({ blocked: tenants.blocked }).from(tenants).where(eq(tenants.id, device.tid))
    if (venue?.blocked) throw new HttpError(403, 'venue_blocked')

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
          inArray(users.pinHash, [hashPin(device.tid, pin), legacyHashPin(device.tid, pin)]),
          eq(users.active, true),
          isNull(users.deletedAt),
        ),
      )
    if (!row || !(row.role.isOwner || row.role.terminalAccess)) {
      noteFailure(key)
      throw new HttpError(401, 'bad_pin')
    }
    clearThrottle(key)
    // ПИН-код, сохранённый по-старому, при входе переводим на ключ заведения: так он заработает и без интернета.
    // Заодно запоминаем сам ПИН-код, если его ещё нет: владелец увидит его в списке сотрудников.
    if (row.user.pinHash !== hashPin(device.tid, pin) || row.user.pin !== pin) {
      await db.update(users).set({ pinHash: hashPin(device.tid, pin), pin }).where(eq(users.id, row.user.id))
    }
    await db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, terminal.id))
    return {
      token: app.jwt.sign({ sub: row.user.id, tid: device.tid, did: terminal.id }, { expiresIn: '16h' }),
    }
  })

  /**
   * Выход кассы из бренда (кнопка «⋮ → Выйти» на экране ПИН-кода). Нужен ПИН-код владельца
   * или администратора: официант отвязать кассу не может.
   */
  app.post('/api/pos/disconnect', async (req) => {
    const { pin } = z.object({ pin: z.string().regex(/^[0-9]{4,6}$/) }).parse(req.body)
    let device: { kind?: string; tid: string; did?: string }
    try {
      device = app.jwt.verify(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    } catch {
      // Токен устройства уже недействителен — держать кассу привязанной незачем.
      return { ok: true }
    }
    if (device.kind !== 'device' || !device.did) return { ok: true }
    const key = 'pin:' + device.did
    checkThrottle(key)
    const [row] = await db
      .select({ role: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, device.tid), inArray(users.pinHash, [hashPin(device.tid, pin), legacyHashPin(device.tid, pin)]), eq(users.active, true), isNull(users.deletedAt)))
    if (!row) {
      noteFailure(key)
      throw new HttpError(401, 'bad_pin')
    }
    clearThrottle(key)
    if (!row.role.isOwner && !row.role.panelAccess) throw new HttpError(403, 'no_permission')
    return { ok: true }
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
      printers: await listPrinters(db, tenantId),
      brand: await brandImages(db, tenantId),
      tableRedMinutes: Number((tenant.settings as Record<string, unknown>).tableRedMinutes ?? 0) || 0,
      dayStartHour: dayStartOf(tenant.settings),
      autoLogoutMinutes: autoLogoutOf(tenant.settings),
      departments: deps,
      user: req.auth,
      shift: await openShift(db, tenantId),
      categories: cats.map((c) => ({ id: c.id, name: c.name, color: c.color, image: c.image?.startsWith('/api/media/item/') ? c.image : null })),
      products: prods.map((p) => ({
        image: p.image?.startsWith('/api/media/item/') || p.image?.startsWith('https://') ? p.image : null,
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
        tables: tableRows
          .filter((t) => t.hallId === h.id)
          .map((t) => ({ id: t.id, name: t.name, seats: t.seats, serviceBp: t.serviceBp ?? h.serviceBp, x: t.x, y: t.y, w: t.w, h: t.h, shape: t.shape })),
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
    // Внесения и изъятия наличных за смену (например, дневные расходы).
    const movements = await conn
      .select({
        id: cashMovements.id,
        kind: cashMovements.kind,
        type: cashMovements.type,
        category: schema.financeCategories.name,
        amount: cashMovements.amount,
        note: cashMovements.note,
        createdAt: cashMovements.createdAt,
        userName: users.name,
      })
      .from(cashMovements)
      .leftJoin(users, eq(users.id, cashMovements.userId))
      .leftJoin(schema.financeCategories, eq(schema.financeCategories.id, cashMovements.categoryId))
      .where(eq(cashMovements.shiftId, shift.id))
      .orderBy(asc(cashMovements.createdAt))
    const cashIn = movements.filter((m) => m.kind === 'in').reduce((s, m) => s + m.amount, 0)
    const cashOut = movements.filter((m) => m.kind === 'out').reduce((s, m) => s + m.amount, 0)
    return {
      receipts: closed.length,
      revenue: closed.reduce((s, r) => s + r.total, 0),
      byMethod,
      openReceipts: openCount,
      openingCash: shift.openingCash,
      cashSales: cash,
      cashIn,
      cashOut,
      movements,
      expectedCash: shift.openingCash + cash + cashIn - cashOut,
    }
  }

  app.get('/api/pos/shift', pos, async (req) => {
    const shift = await openShift(db, req.auth.tenantId)
    return { shift, summary: shift ? await shiftSummary(db, shift) : null }
  })

  /** Внесение или изъятие наличных из кассы — например, дневной расход на продукты. */
  app.post('/api/pos/shift/cash', pos, async (req) => {
    need(req, 'shift.cash_movement')
    const body = z
      .object({
        type: z.enum(['expense', 'income', 'collection']),
        amount: z.number().int().min(1).max(1e12),
        categoryId: z.string().uuid().nullish(),
        note: z.string().trim().max(200).nullish(),
      })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    const kind = body.type === 'income' ? 'in' : 'out'
    // Для расхода и дохода категория обязательна: по ней строится отчёт о расходах.
    let categoryName: string | null = null
    if (body.type !== 'collection') {
      if (!body.categoryId) throw new HttpError(400, 'category_required')
      const [cat] = await db
        .select()
        .from(schema.financeCategories)
        .where(and(eq(schema.financeCategories.id, body.categoryId), eq(schema.financeCategories.tenantId, tenantId), isNull(schema.financeCategories.deletedAt)))
      if (!cat || cat.kind !== body.type) throw new HttpError(400, 'bad_category')
      categoryName = cat.name
    }
    return db.transaction(async (tx) => {
      const shift = await openShift(tx, tenantId)
      if (!shift) throw new HttpError(409, 'shift_closed')
      if (kind === 'out') {
        const now = await shiftSummary(tx, shift)
        if (body.amount > now.expectedCash) throw new HttpError(409, 'not_enough_cash')
      }
      await tx.insert(cashMovements).values({
        tenantId,
        shiftId: shift.id,
        userId: req.auth.userId,
        kind,
        type: body.type,
        categoryId: body.type === 'collection' ? null : body.categoryId,
        amount: body.amount,
        note: body.note || null,
      })
      await tx.insert(auditLog).values({
        tenantId,
        userId: req.auth.userId,
        action: 'cash.' + body.type,
        data: { amount: body.amount, category: categoryName, note: body.note ?? null, shift: shift.number },
      })
      return { summary: await shiftSummary(tx, shift) }
    })
  })

  /** Чеки текущей смены: закрытые и отменённые. Кассир без права «чеки всех» видит только свои. */
  app.get('/api/pos/archive', pos, async (req) => {
    const tenantId = req.auth.tenantId
    const shift = await openShift(db, tenantId)
    if (!shift) return { shift: null, receipts: [] }
    const mine = can(req, 'receipt.see_all') ? undefined : eq(receipts.waiterId, req.auth.userId)
    const rows = await db
      .select({
        id: receipts.id,
        number: receipts.number,
        status: receipts.status,
        tableName: tables.name,
        saleTypeId: receipts.saleTypeId,
        waiterName: users.name,
        total: receipts.total,
        closedAt: receipts.closedAt,
      })
      .from(receipts)
      .leftJoin(tables, eq(tables.id, receipts.tableId))
      .leftJoin(users, eq(users.id, receipts.waiterId))
      .where(and(eq(receipts.shiftId, shift.id), inArray(receipts.status, ['closed', 'cancelled', 'refunded']), mine))
      .orderBy(desc(receipts.closedAt))
      .limit(300)
    return { shift: { number: shift.number }, receipts: rows }
  })

  /** Кассы (устройства) заведения; текущее устройство отмечено. */
  app.get('/api/pos/devices', pos, async (req) => {
    const rows = await db
      .select({ id: terminals.id, name: terminals.name, active: terminals.active, lastSeenAt: terminals.lastSeenAt, createdAt: terminals.createdAt })
      .from(terminals)
      .where(eq(terminals.tenantId, req.auth.tenantId))
      .orderBy(desc(terminals.lastSeenAt))
    return rows.map((r) => ({ ...r, current: r.id === req.user.did }))
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
        .select({ max: sql<number>`greatest(coalesce(max(${shifts.number}), 0), ${numberBase('shift', tenantId)})::int`.mapWith(Number) })
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

  /** Сумма позиции: цена × количество минус её собственная скидка (процентом или суммой). */
  const lineSums = (price: number, qty: number, percent: number, amount: number) => {
    const gross = Math.round((price * qty) / 1000)
    const discountAmount = percent > 0 ? Math.round((gross * percent) / 100) : Math.min(amount, gross)
    return { total: gross - discountAmount, discountAmount }
  }

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
        discountAmount: i.discountAmount,
        discountPercent: i.discountPercent,
        comment: i.comment,
        sent: i.sentAt != null,
        voided: i.voidedAt != null,
        comp: i.comp,
      })),
    }
  }

  /** Загружает открытый чек и проверяет, что сотрудник вправе с ним работать. */
  async function loadOpen(conn: Conn, req: FastifyRequest, receiptId: string, allowLocked = false) {
    const [r] = await conn
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, req.auth.tenantId)))
    if (!r) throw new HttpError(404, 'not_found')
    if (r.waiterId !== req.auth.userId && !can(req, 'receipt.see_all')) throw new HttpError(403, 'no_permission')
    if (r.status !== 'open') throw new HttpError(409, 'receipt_closed')
    // Заблокированный чек нельзя менять: только отправить на кухню, напечатать счёт, оплатить или разблокировать.
    if (r.locked && !allowLocked) throw new HttpError(409, 'receipt_locked')
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
        // Когда в чек последний раз добавляли позицию: по этому стол краснеет после простоя.
        lastItemAt: sql<string | null>`(select max(ri.created_at) from receipt_items ri where ri.receipt_id = ${receipts.id})`,
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

      // Процент обслуживания стола важнее процента способа продажи.
      let tableServiceBp: number | null = null
      if (body.tableId) {
        const [t] = await tx
          .select({ id: tables.id, serviceBp: tables.serviceBp, hallServiceBp: halls.serviceBp })
          .from(tables)
          .innerJoin(halls, eq(halls.id, tables.hallId))
          .where(and(eq(tables.id, body.tableId), eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
        if (!t) throw new HttpError(400, 'bad_table')
        // Сначала процент стола, затем зала; если нет ни того ни другого — способа продажи.
        tableServiceBp = t.serviceBp ?? t.hallServiceBp
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
        .select({ max: sql<number>`greatest(coalesce(max(${receipts.number}), 0), ${numberBase('receipt', tenantId)})::int`.mapWith(Number) })
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
          serviceBp: tableServiceBp ?? type.serviceBp,
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
      await loadOpen(tx, req, id, true)
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
        await tx.update(receiptItems).set({ qty, ...lineSums(p.price, qty, same.discountPercent, same.discountAmount) }).where(eq(receiptItems.id, same.id))
      } else {
        await tx.insert(receiptItems).values({
          tenantId,
          receiptId: id,
          productId: p.id,
          name: p.name,
          departmentId: p.departmentId,
          price: p.price,
          cost: p.cost,
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
          .set({ qty, ...lineSums(item.price, qty, item.discountPercent, item.discountAmount), ...(body.comment !== undefined ? { comment: body.comment } : {}) })
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
      const r = await loadOpen(tx, req, id, true)
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

  /** История чека для кассы: кто, что и когда делал; подозрительные действия помечены. */
  app.get('/api/pos/receipts/:id/history', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const [r] = await db.select({ waiterId: receipts.waiterId }).from(receipts).where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)))
    if (!r) throw new HttpError(404, 'not_found')
    if (r.waiterId !== req.auth.userId && !can(req, 'receipt.see_all')) throw new HttpError(403, 'no_permission')
    return db
      .select({ id: auditLog.id, action: auditLog.action, data: auditLog.data, suspicious: auditLog.suspicious, createdAt: auditLog.createdAt, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(and(eq(auditLog.receiptId, id), eq(auditLog.tenantId, tenantId)))
      .orderBy(asc(auditLog.createdAt))
  })

  /**
   * «Открыть чек ещё раз»: закрытый чек текущей смены снова становится открытым, оплата снимается.
   * Нужно право; стол чека должен быть свободен.
   */
  app.post('/api/pos/receipts/:id/reopen', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    need(req, 'receipt.reopen')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const [r] = await tx.select().from(receipts).where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)))
      if (!r) throw new HttpError(404, 'not_found')
      if (r.status !== 'closed') throw new HttpError(409, 'receipt_not_closed')
      const shift = await openShift(tx, tenantId)
      if (!shift || shift.id !== r.shiftId) throw new HttpError(409, 'refund_other_shift')
      if (r.tableId) {
        const [taken] = await tx
          .select({ id: receipts.id })
          .from(receipts)
          .where(and(eq(receipts.tenantId, tenantId), eq(receipts.tableId, r.tableId), eq(receipts.status, 'open')))
        if (taken) throw new HttpError(409, 'table_taken')
      }
      await tx.delete(payments).where(eq(payments.receiptId, id))
      await tx.update(receipts).set({ status: 'open', closedAt: null, billPrinted: false, suspicious: true }).where(eq(receipts.id, id))
      await adjustStockForReceipt(tx, id, 1)
      await log(tx, req, id, 'receipt.reopen', { number: r.number, total: r.total }, true)
      return fullReceipt(tx, tenantId, id)
    })
  })

  /**
   * «Разделить счёт», как в Clopos: выбранные позиции (целиком или часть количества) уходят в новый чек
   * за тем же столом. Новый чек наследует сотрудника, способ продажи, процент обслуживания и скидку в процентах.
   * В исходном чеке должна остаться хотя бы одна позиция.
   */
  app.post('/api/pos/receipts/:id/split', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({ items: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(100_000_000) })).min(1).max(200) })
      .parse(req.body)
    need(req, 'receipt.transfer')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r = await loadOpen(tx, req, id)
      const live = await tx.select().from(receiptItems).where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.voidedAt)))
      const byId = new Map(live.map((i) => [i.id, i]))
      const want = new Map<string, number>()
      for (const x of body.items) want.set(x.itemId, (want.get(x.itemId) ?? 0) + x.qty)
      for (const [itemId, qty] of want) {
        const item = byId.get(itemId)
        if (!item) throw new HttpError(400, 'bad_item')
        if (qty > item.qty) throw new HttpError(400, 'bad_qty')
      }
      // Нельзя унести всё: тогда это не разделение, а тот же чек.
      if (live.every((i) => want.get(i.id) === i.qty)) throw new HttpError(400, 'split_all')

      const [{ max }] = await tx
        .select({ max: sql<number>`greatest(coalesce(max(${receipts.number}), 0), ${numberBase('receipt', tenantId)})::int`.mapWith(Number) })
        .from(receipts)
        .where(eq(receipts.tenantId, tenantId))
      const [created] = await tx
        .insert(receipts)
        .values({
          tenantId,
          branchId: r.branchId,
          shiftId: r.shiftId,
          number: max + 1,
          saleTypeId: r.saleTypeId,
          tableId: r.tableId,
          waiterId: r.waiterId,
          guests: 1,
          serviceBp: r.serviceBp,
          // Скидка в процентах действует на обе части; скидка суммой остаётся в исходном чеке.
          ...(r.discountKind === 'percent' ? { discountKind: r.discountKind, discountValue: r.discountValue } : {}),
        })
        .returning()

      for (const [itemId, qty] of want) {
        const item = byId.get(itemId)!
        if (qty === item.qty) {
          await tx.update(receiptItems).set({ receiptId: created.id }).where(eq(receiptItems.id, itemId))
          continue
        }
        // Часть количества: строка делится на две, суммы — пропорционально.
        const movedTotal = Math.round((item.total * qty) / item.qty)
        const movedDiscount = Math.round((item.discountAmount * qty) / item.qty)
        const { id: _id, ...copy } = item
        await tx.insert(receiptItems).values({ ...copy, receiptId: created.id, qty, total: movedTotal, discountAmount: movedDiscount })
        await tx
          .update(receiptItems)
          .set({ qty: item.qty - qty, total: item.total - movedTotal, discountAmount: item.discountAmount - movedDiscount })
          .where(eq(receiptItems.id, itemId))
      }
      // Счёт, выданный гостю до разделения, уже неверен.
      if (r.billPrinted) await tx.update(receipts).set({ billPrinted: false }).where(eq(receipts.id, id))
      await recalc(tx, id)
      await recalc(tx, created.id)
      await log(tx, req, id, 'receipt.split', { to: created.number, items: want.size })
      await log(tx, req, created.id, 'receipt.open', { number: created.number, splitFrom: r.number })
      return { receipt: await fullReceipt(tx, tenantId, id), created: await fullReceipt(tx, tenantId, created.id) }
    })
  })

  /**
   * «Объединить чеки», как в Clopos: все позиции другого открытого чека переходят в этот.
   * Присоединённый чек получает статус «объединён» (в панели — вкладка «Объединённые») и больше не открыт.
   * Стол, обслуживание и скидка остаются от чека, в который объединяют; гости складываются.
   */
  app.post('/api/pos/receipts/:id/merge', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const { fromId } = z.object({ fromId: z.string().uuid() }).parse(req.body)
    need(req, 'receipt.transfer')
    if (fromId === id) throw new HttpError(400, 'same_receipt')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const target = await loadOpen(tx, req, id)
      const source = await loadOpen(tx, req, fromId)
      await tx.update(receiptItems).set({ receiptId: id }).where(eq(receiptItems.receiptId, fromId))
      await tx
        .update(receipts)
        .set({ status: 'merged', closedAt: new Date(), subtotal: 0, total: 0, serviceAmount: 0, discountAmount: 0, billPrinted: false })
        .where(eq(receipts.id, fromId))
      // Счёт, выданный гостю до объединения, уже неверен.
      await tx.update(receipts).set({ guests: target.guests + source.guests, billPrinted: false }).where(eq(receipts.id, id))
      await recalc(tx, id)
      await log(tx, req, id, 'receipt.merge', { from: source.number })
      await log(tx, req, fromId, 'receipt.merged', { to: target.number })
      return fullReceipt(tx, tenantId, id)
    })
  })

  /** Сотрудники, на которых можно перевести чек: все действующие с доступом к кассе. */
  app.get('/api/pos/waiters', pos, async (req) =>
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, req.auth.tenantId), eq(users.active, true), isNull(users.deletedAt), sql`(${roles.isOwner} or ${roles.terminalAccess})`))
      .orderBy(asc(users.name)),
  )

  /** Сменить сотрудника чека (как «Изменить владельца чека» в Clopos). Нужно право на перенос. */
  app.post('/api/pos/receipts/:id/waiter', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const { waiterId } = z.object({ waiterId: z.string().uuid() }).parse(req.body)
    need(req, 'receipt.transfer')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r = await loadOpen(tx, req, id)
      const [next] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.id, waiterId), eq(users.tenantId, tenantId), eq(users.active, true), isNull(users.deletedAt), sql`(${roles.isOwner} or ${roles.terminalAccess})`))
      if (!next) throw new HttpError(400, 'bad_waiter')
      if (r.waiterId !== next.id) {
        const [prev] = r.waiterId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, r.waiterId)) : []
        await tx.update(receipts).set({ waiterId: next.id }).where(eq(receipts.id, id))
        await log(tx, req, id, 'receipt.waiter', { from: prev?.name ?? null, to: next.name })
      }
      return fullReceipt(tx, tenantId, id)
    })
  })

  /**
   * Сменить способ продажи чека («В зале» ↔ «С собой» ↔ «Доставка»). Нужно право на перенос.
   * Не «в зале» — чек уходит со стола, обслуживание берётся из нового способа продажи.
   */
  app.post('/api/pos/receipts/:id/sale-type', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const { saleTypeId } = z.object({ saleTypeId: z.string().uuid() }).parse(req.body)
    need(req, 'receipt.transfer')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r = await loadOpen(tx, req, id)
      const [type] = await tx.select().from(saleTypes).where(and(eq(saleTypes.id, saleTypeId), eq(saleTypes.tenantId, tenantId), eq(saleTypes.active, true)))
      if (!type) throw new HttpError(400, 'bad_sale_type')
      if (r.saleTypeId !== type.id) {
        const [prev] = r.saleTypeId ? await tx.select({ name: saleTypes.name }).from(saleTypes).where(eq(saleTypes.id, r.saleTypeId)) : []
        // За столом процент стола или зала уже стоит в чеке; без стола — берём процент способа продажи.
        const keepTable = type.kind === 'hall' && r.tableId
        await tx
          .update(receipts)
          .set({ saleTypeId: type.id, ...(keepTable ? {} : { tableId: null, serviceBp: type.serviceBp }) })
          .where(eq(receipts.id, id))
        await log(tx, req, id, 'receipt.sale_type', { from: prev?.name ?? null, to: type.name })
        await recalc(tx, id)
      }
      return fullReceipt(tx, tenantId, id)
    })
  })

  /**
   * Блокировка чека: после неё чек нельзя менять (добавлять, удалять, скидки, перенос), пока блокировку не снимут.
   * Заблокировать может любой, кто работает с чеком; снять — тот, у кого есть право открывать закрытые чеки.
   */
  app.post('/api/pos/receipts/:id/lock', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body)
    if (!locked) need(req, 'receipt.reopen')
    return db.transaction(async (tx) => {
      const r = await loadOpen(tx, req, id, true)
      if (r.locked !== locked) {
        await tx.update(receipts).set({ locked }).where(eq(receipts.id, id))
        await log(tx, req, id, locked ? 'receipt.lock' : 'receipt.unlock', {}, !locked)
      }
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  /** Перенести чек на другой стол (как «Перенос стола» в Clopos). Нужно право; стол должен быть свободен. */
  app.post('/api/pos/receipts/:id/move', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const { tableId } = z.object({ tableId: z.string().uuid() }).parse(req.body)
    need(req, 'receipt.transfer')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r = await loadOpen(tx, req, id)
      if (r.tableId === tableId) return fullReceipt(tx, tenantId, id)
      const [target] = await tx
        .select({ id: tables.id, name: tables.name, serviceBp: sql<number | null>`coalesce(${tables.serviceBp}, ${halls.serviceBp})` })
        .from(tables)
        .innerJoin(halls, eq(halls.id, tables.hallId))
        .where(and(eq(tables.id, tableId), eq(tables.tenantId, tenantId), isNull(tables.deletedAt)))
      if (!target) throw new HttpError(400, 'bad_table')
      const [taken] = await tx
        .select({ id: receipts.id })
        .from(receipts)
        .where(and(eq(receipts.tenantId, tenantId), eq(receipts.tableId, tableId), eq(receipts.status, 'open')))
      if (taken) throw new HttpError(409, 'table_taken')
      const [from] = r.tableId ? await tx.select({ name: tables.name }).from(tables).where(eq(tables.id, r.tableId)) : []
      // У стола может быть свой процент обслуживания: он переходит вместе с новым столом.
      await tx
        .update(receipts)
        .set({ tableId, ...(target.serviceBp != null ? { serviceBp: target.serviceBp } : {}) })
        .where(eq(receipts.id, id))
      await log(tx, req, id, 'receipt.move', { from: from?.name ?? null, to: target.name })
      await recalc(tx, id)
      return fullReceipt(tx, tenantId, id)
    })
  })

  /** Изменить цену позиции в чеке. Нужно право; действие попадает в подозрительные. */
  app.post('/api/pos/receipts/:id/items/:itemId/price', pos, async (req) => {
    const { id, itemId } = itemParam.parse(req.params)
    const { price } = z.object({ price: z.number().int().min(0).max(1_000_000_000) }).parse(req.body)
    need(req, 'receipt.change_price')
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const [item] = await tx.select().from(receiptItems).where(and(eq(receiptItems.id, itemId), eq(receiptItems.receiptId, id)))
      if (!item || item.voidedAt) throw new HttpError(404, 'not_found')
      if (item.price !== price) {
        await tx.update(receiptItems).set({ price, ...lineSums(price, item.qty, item.discountPercent, item.discountAmount) }).where(eq(receiptItems.id, itemId))
        await tx.update(receipts).set({ suspicious: true }).where(eq(receipts.id, id))
        await log(tx, req, id, 'item.price', { name: item.name, from: item.price, to: price }, true)
        await recalc(tx, id)
      }
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  /**
   * Скидка на отдельную позицию (как «Скидка на товар» в Clopos): процентом или суммой.
   * Скидка на весь чек считается уже после неё. Нужно то же право, что и для скидки на чек.
   */
  app.post('/api/pos/receipts/:id/items/:itemId/discount', pos, async (req) => {
    const { id, itemId } = itemParam.parse(req.params)
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
      const [item] = await tx.select().from(receiptItems).where(and(eq(receiptItems.id, itemId), eq(receiptItems.receiptId, id)))
      if (!item || item.voidedAt) throw new HttpError(404, 'not_found')
      const percent = body.kind === 'percent' ? body.value : 0
      const amount = body.kind === 'amount' ? body.value : 0
      const sums = lineSums(item.price, item.qty, percent, amount)
      await tx.update(receiptItems).set({ discountPercent: percent, ...sums }).where(eq(receiptItems.id, itemId))
      // Большая скидка — повод владельцу посмотреть чек.
      const big = sums.discountAmount > 0 && sums.discountAmount * 5 >= sums.total + sums.discountAmount
      if (big) await tx.update(receipts).set({ suspicious: true }).where(eq(receipts.id, id))
      await log(tx, req, id, 'item.discount', { name: item.name, kind: body.kind, value: body.kind === 'none' ? 0 : body.value, amount: sums.discountAmount }, big)
      await recalc(tx, id)
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  /** Угощение: позиция остаётся в чеке, но гость за неё не платит. Нужно право. */
  app.post('/api/pos/receipts/:id/items/:itemId/comp', pos, async (req) => {
    const { id, itemId } = itemParam.parse(req.params)
    const { comp } = z.object({ comp: z.boolean() }).parse(req.body)
    need(req, 'receipt.comp')
    return db.transaction(async (tx) => {
      await loadOpen(tx, req, id)
      const [item] = await tx.select().from(receiptItems).where(and(eq(receiptItems.id, itemId), eq(receiptItems.receiptId, id)))
      if (!item || item.voidedAt) throw new HttpError(404, 'not_found')
      if (item.comp !== comp) {
        await tx.update(receiptItems).set({ comp }).where(eq(receiptItems.id, itemId))
        if (comp) await tx.update(receipts).set({ suspicious: true }).where(eq(receipts.id, id))
        await log(tx, req, id, comp ? 'item.comp' : 'item.uncomp', { name: item.name, qty: item.qty, total: item.total }, comp)
        await recalc(tx, id)
      }
      return fullReceipt(tx, req.auth.tenantId, id)
    })
  })

  /**
   * Возврат закрытого чека: деньги возвращают гостю, чек выпадает из выручки.
   * Только в текущей смене — закрытую смену возврат не переписывает.
   */
  app.post('/api/pos/receipts/:id/refund', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    need(req, 'receipt.refund')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const [r] = await tx.select().from(receipts).where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)))
      if (!r) throw new HttpError(404, 'not_found')
      if (r.status !== 'closed') throw new HttpError(409, 'receipt_not_closed')
      const shift = await openShift(tx, tenantId)
      if (!shift || shift.id !== r.shiftId) throw new HttpError(409, 'refund_other_shift')
      await tx.update(receipts).set({ status: 'refunded', suspicious: true }).where(eq(receipts.id, id))
      await adjustStockForReceipt(tx, id, 1)
      await log(tx, req, id, 'receipt.refund', { number: r.number, total: r.total }, true)
      return fullReceipt(tx, tenantId, id)
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

  /**
   * Процент обслуживания в самом чеке. null — вернуть обычный: по столу, залу или типу продажи.
   * Снижение процента попадает в отчёт «Подозрительные».
   */
  app.post('/api/pos/receipts/:id/service', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ percent: z.number().min(0).max(100).nullable() }).parse(req.body)
    need(req, 'receipt.discount')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r0 = await loadOpen(tx, req, id)
      let to: number
      if (body.percent === null) {
        const [d] = await tx
          .select({ tableBp: tables.serviceBp, hallBp: halls.serviceBp, typeBp: saleTypes.serviceBp })
          .from(receipts)
          .leftJoin(tables, eq(tables.id, receipts.tableId))
          .leftJoin(halls, eq(halls.id, tables.hallId))
          .leftJoin(saleTypes, eq(saleTypes.id, receipts.saleTypeId))
          .where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)))
        to = d?.tableBp ?? d?.hallBp ?? d?.typeBp ?? 0
      } else to = Math.round(body.percent * 100)
      if (to !== r0.serviceBp) {
        const lowered = to < r0.serviceBp
        await tx.update(receipts).set({ serviceBp: to, ...(lowered ? { suspicious: true } : {}) }).where(eq(receipts.id, id))
        await recalc(tx, id)
        const [r1] = await tx.select({ serviceAmount: receipts.serviceAmount }).from(receipts).where(eq(receipts.id, id))
        await log(tx, req, id, 'receipt.service', { from: r0.serviceBp / 100, to: to / 100, amount: Math.max(0, r0.serviceAmount - r1.serviceAmount) }, lowered)
      }
      return fullReceipt(tx, tenantId, id)
    })
  })

  /**
   * «Закрыть без оплаты»: чек закрывается с нулевой суммой — угощение за счёт заведения, питание персонала.
   * Товары списываются как при обычной продаже, денег в кассу не приходит. Всегда подозрительное действие.
   */
  app.post('/api/pos/receipts/:id/close-unpaid', pos, async (req) => {
    const { id } = idParam.parse(req.params)
    need(req, 'receipt.discount')
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const r0 = await loadOpen(tx, req, id, true)
      await tx.update(receiptItems).set({ sentAt: new Date() }).where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.sentAt), isNull(receiptItems.voidedAt)))
      await recalc(tx, id)
      const [r] = await tx.select().from(receipts).where(eq(receipts.id, id))
      const live = await tx.select({ id: receiptItems.id }).from(receiptItems).where(and(eq(receiptItems.receiptId, id), isNull(receiptItems.voidedAt))).limit(1)
      if (!live.length) throw new HttpError(409, 'receipt_empty')
      // Вся сумма уходит в скидку: выручка по чеку — ноль, а в отчётах видно, сколько списано.
      await tx.update(receipts).set({ discountKind: 'percent', discountValue: 100 }).where(eq(receipts.id, id))
      await recalc(tx, id)
      await tx.update(receipts).set({ status: 'closed', closedAt: new Date(), suspicious: true }).where(eq(receipts.id, id))
      await adjustStockForReceipt(tx, id, -1)
      await log(tx, req, id, 'receipt.close_unpaid', { total: r.total, number: r0.number }, true)
      return { receipt: await fullReceipt(tx, tenantId, id) }
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
      const r0 = await loadOpen(tx, req, id, true)
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
      // Товары с учётом остатка списываются в момент оплаты.
      await adjustStockForReceipt(tx, id, -1)
      await log(tx, req, id, 'receipt.pay', { total: r.total, paid, change, number: r0.number })
      return { receipt: await fullReceipt(tx, tenantId, id), change }
    })
  })
}
