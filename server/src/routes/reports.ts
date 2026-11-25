import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { receipts, receiptItems, payments, paymentMethods, saleTypes, users, tables, products, categories, reasons, auditLog, shifts } =
  schema

/**
 * Часовой пояс заведения: Ташкент, UTC+5, без перехода на летнее время.
 * Смещение задано числом, чтобы отчёты не зависели от базы часовых поясов на сервере.
 */
const TZ_HOURS = 5

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const rangeQuery = z.object({ from: day, to: day })

/** Границы периода: с начала дня `from` до конца дня `to` по времени заведения. */
function range(q: unknown) {
  const { from, to } = rangeQuery.parse(q)
  const offset = `${TZ_HOURS >= 0 ? '+' : '-'}${String(Math.abs(TZ_HOURS)).padStart(2, '0')}:00`
  const start = new Date(`${from}T00:00:00${offset}`)
  const end = new Date(new Date(`${to}T00:00:00${offset}`).getTime() + 86_400_000)
  if (!(start < end) || end.getTime() - start.getTime() > 400 * 86_400_000) throw new HttpError(400, 'bad_range')
  return { start, end }
}

/** Момент закрытия чека в местном времени заведения. */
const localClosed = sql`(${receipts.closedAt} at time zone 'UTC' + make_interval(hours => ${TZ_HOURS}))`
const num = (expr: SQL) => sql<number>`coalesce(${expr}, 0)::bigint`.mapWith(Number)

/** Период отчёта: точные моменты «с — до» или одна смена целиком. */
export type ReportFilter = { start: Date; end: Date } | { shiftId: string }

/**
 * Сводный отчёт: выручка, оплаты, типы продаж, сотрудники, товары, категории, отделы и операции с наличными.
 * Общий для панели (по дням) и кассы (по дате со временем или по смене).
 */
export async function buildSummary(db: DB, tenantId: string, f: ReportFilter) {
  {
    const byShift = 'shiftId' in f
    // Выручка считается по закрытым чекам и относится к моменту закрытия.
    const closed = and(
      eq(receipts.tenantId, tenantId),
      eq(receipts.status, 'closed'),
      byShift ? eq(receipts.shiftId, f.shiftId) : and(gte(receipts.closedAt, f.start), lt(receipts.closedAt, f.end)),
    )
    const liveItem = and(isNull(receiptItems.voidedAt), eq(receiptItems.comp, false))

    const [[totals], byDay, byHour, byMethod, bySaleType, byWaiter, byProduct, [voids]] = await Promise.all([
      db
        .select({
          receipts: num(sql`count(*)`),
          revenue: num(sql`sum(${receipts.total})`),
          guests: num(sql`sum(${receipts.guests})`),
          discounts: num(sql`sum(${receipts.discountAmount})`),
          service: num(sql`sum(${receipts.serviceAmount})`),
        })
        .from(receipts)
        .where(closed),
      db
        .select({
          day: sql<string>`to_char(${localClosed}, 'YYYY-MM-DD')`,
          receipts: num(sql`count(*)`),
          revenue: num(sql`sum(${receipts.total})`),
        })
        .from(receipts)
        .where(closed)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          hour: sql<number>`extract(hour from ${localClosed})::int`.mapWith(Number),
          receipts: num(sql`count(*)`),
          revenue: num(sql`sum(${receipts.total})`),
        })
        .from(receipts)
        .where(closed)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({ id: paymentMethods.id, name: paymentMethods.name, amount: num(sql`sum(${payments.amount})`) })
        .from(payments)
        .innerJoin(receipts, eq(receipts.id, payments.receiptId))
        .innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId))
        .where(closed)
        .groupBy(paymentMethods.id, paymentMethods.name, paymentMethods.sort)
        .orderBy(asc(paymentMethods.sort)),
      db
        .select({
          id: saleTypes.id,
          name: saleTypes.name,
          receipts: num(sql`count(*)`),
          revenue: num(sql`sum(${receipts.total})`),
        })
        .from(receipts)
        .innerJoin(saleTypes, eq(saleTypes.id, receipts.saleTypeId))
        .where(closed)
        .groupBy(saleTypes.id, saleTypes.name, saleTypes.sort)
        .orderBy(asc(saleTypes.sort)),
      db
        .select({
          id: users.id,
          name: users.name,
          receipts: num(sql`count(*)`),
          revenue: num(sql`sum(${receipts.total})`),
        })
        .from(receipts)
        .innerJoin(users, eq(users.id, receipts.waiterId))
        .where(closed)
        .groupBy(users.id, users.name)
        .orderBy(desc(sql`sum(${receipts.total})`)),
      db
        .select({
          productId: receiptItems.productId,
          name: sql<{ uz: string; ru: string }>`min(${receiptItems.name}::text)::jsonb`,
          categoryId: sql<string | null>`min(${products.categoryId}::text)`,
          qty: num(sql`sum(${receiptItems.qty})`),
          amount: num(sql`sum(${receiptItems.total})`),
          // Себестоимость берётся из снимка в строке чека: изменение цены закупки не переписывает прошлое.
          cost: num(sql`sum(round(${receiptItems.cost} * ${receiptItems.qty} / 1000.0))`),
          noCostAmount: num(sql`sum(case when ${receiptItems.cost} = 0 then ${receiptItems.total} else 0 end)`),
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
        .leftJoin(products, eq(products.id, receiptItems.productId))
        .where(and(closed, liveItem))
        .groupBy(receiptItems.productId)
        .orderBy(desc(sql`sum(${receiptItems.total})`)),
      db
        .select({ count: num(sql`count(*)`), amount: num(sql`sum(${receiptItems.total})`) })
        .from(receiptItems)
        .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
        .where(and(closed, sql`${receiptItems.voidedAt} is not null`)),
    ])

    // Категории собираем из товаров: так удалённая категория не теряет продажи.
    const cats = await db
      .select({ id: categories.id, name: categories.name, color: categories.color })
      .from(categories)
      .where(eq(categories.tenantId, tenantId))
    const catById = new Map(cats.map((c) => [c.id, c]))
    const byCategoryMap = new Map<string, { id: string | null; name: { uz: string; ru: string } | null; qty: number; amount: number; cost: number }>()
    for (const p of byProduct) {
      const key = p.categoryId ?? ''
      const cur = byCategoryMap.get(key) ?? { id: p.categoryId, name: catById.get(key)?.name ?? null, qty: 0, amount: 0, cost: 0 }
      cur.qty += p.qty
      cur.amount += p.amount
      cur.cost += p.cost
      byCategoryMap.set(key, cur)
    }

    // Операции с наличными за период: расходы, доходы, инкассация — по категориям.
    const parentCat = alias(schema.financeCategories, 'parent_cat')
    const cashRows = await db
      .select({
        type: schema.cashMovements.type,
        kind: schema.cashMovements.kind,
        category: schema.financeCategories.name,
        parent: parentCat.name,
        amount: num(sql`sum(${schema.cashMovements.amount})`),
        count: num(sql`count(*)`),
      })
      .from(schema.cashMovements)
      .leftJoin(schema.financeCategories, eq(schema.financeCategories.id, schema.cashMovements.categoryId))
      .leftJoin(parentCat, eq(parentCat.id, schema.financeCategories.parentId))
      .where(
        and(
          eq(schema.cashMovements.tenantId, tenantId),
          byShift
            ? eq(schema.cashMovements.shiftId, f.shiftId)
            : and(gte(schema.cashMovements.createdAt, f.start), lt(schema.cashMovements.createdAt, f.end)),
        ),
      )
      .groupBy(schema.cashMovements.type, schema.cashMovements.kind, schema.financeCategories.name, parentCat.name)
    // Старые операции без типа: внесение считаем доходом, изъятие — расходом.
    const typeOf = (r: { type: string | null; kind: string }) => r.type ?? (r.kind === 'in' ? 'income' : 'expense')
    const cashSum = (t: string) => cashRows.filter((r) => typeOf(r) === t).reduce((a, r) => a + r.amount, 0)
    const cash = {
      expense: cashSum('expense'),
      income: cashSum('income'),
      collection: cashSum('collection'),
      byCategory: cashRows
        .map((r) => ({ type: typeOf(r), name: r.category, parent: r.parent, amount: r.amount, count: r.count }))
        .sort((a, b) => b.amount - a.amount),
    }
    // Отделы (кухня, бар…) — по снимку отдела в строке чека.
    const byDepartment = await db
      .select({
        id: receiptItems.departmentId,
        name: schema.departments.name,
        qty: num(sql`sum(${receiptItems.qty})`),
        amount: num(sql`sum(${receiptItems.total})`),
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
      .leftJoin(schema.departments, eq(schema.departments.id, receiptItems.departmentId))
      .where(and(closed, liveItem))
      .groupBy(receiptItems.departmentId, schema.departments.name)
      .orderBy(desc(sql`sum(${receiptItems.total})`))
    const cost = byProduct.reduce((s, p) => s + p.cost, 0)
    return {
      byDepartment,
      totals: {
        ...totals,
        average: totals.receipts ? Math.round(totals.revenue / totals.receipts) : 0,
        cost,
        /** Валовая прибыль: выручка минус себестоимость проданного */
        profit: totals.revenue - cost,
        /** Продажи товаров без указанной себестоимости — по ним прибыль завышена */
        noCostAmount: byProduct.reduce((s, p) => s + p.noCostAmount, 0),
      },
      voids,
      cash,
      byDay,
      byHour,
      byMethod,
      bySaleType,
      byWaiter,
      byCategory: [...byCategoryMap.values()].sort((a, b) => b.amount - a.amount),
      byProduct,
    }
  }
}

export function reportRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm, requirePos } = makeAuthGuards(db)

  // ───────────── Отчёты ─────────────

  app.get('/api/reports/summary', { preHandler: requirePerm('reports.view') }, async (req) => buildSummary(db, req.auth.tenantId, range(req.query)))

  // ───────────── Отчёт на кассе: с даты-времени по дату-время или по смене ─────────────

  const canKassaReport = (req: { auth: { role: { permissions: string[] } } }) => {
    const p = req.auth.role.permissions
    if (!p.includes('reports.view') && !p.includes('shift.open_close')) throw new HttpError(403, 'no_permission')
  }

  app.get('/api/pos/report', { preHandler: requirePos }, async (req) => {
    canKassaReport(req)
    const q = z
      .object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), shiftId: z.string().uuid().optional() })
      .parse(req.query)
    const tenantId = req.auth.tenantId
    if (q.shiftId) {
      const [s] = await db
        .select({ id: shifts.id })
        .from(shifts)
        .where(and(eq(shifts.id, q.shiftId), eq(shifts.tenantId, tenantId)))
      if (!s) throw new HttpError(404, 'not_found')
      return buildSummary(db, tenantId, { shiftId: q.shiftId })
    }
    if (!q.from || !q.to) throw new HttpError(400, 'bad_range')
    const start = new Date(q.from)
    const end = new Date(q.to)
    if (!(start < end) || end.getTime() - start.getTime() > 400 * 86_400_000) throw new HttpError(400, 'bad_range')
    return buildSummary(db, tenantId, { start, end })
  })

  // Последние смены для выбора в отчёте
  app.get('/api/pos/report/shifts', { preHandler: requirePos }, async (req) => {
    canKassaReport(req)
    return db
      .select({ id: shifts.id, number: shifts.number, openedAt: shifts.openedAt, closedAt: shifts.closedAt })
      .from(shifts)
      .where(eq(shifts.tenantId, req.auth.tenantId))
      .orderBy(desc(shifts.openedAt))
      .limit(60)
  })

  app.get('/api/reports/shifts', { preHandler: requirePerm('reports.view') }, async (req) => {
    const { start, end } = range(req.query)
    const tenantId = req.auth.tenantId
    const opener = alias(users, 'opener')
    const closer = alias(users, 'closer')
    const rows = await db
      .select({
        id: shifts.id,
        number: shifts.number,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        openedBy: opener.name,
        closedBy: closer.name,
        openingCash: shifts.openingCash,
        expectedCash: shifts.expectedCash,
        countedCash: shifts.countedCash,
      })
      .from(shifts)
      .innerJoin(opener, eq(opener.id, shifts.openedBy))
      .leftJoin(closer, eq(closer.id, shifts.closedBy))
      .where(and(eq(shifts.tenantId, tenantId), gte(shifts.openedAt, start), lt(shifts.openedAt, end)))
      .orderBy(desc(shifts.openedAt))
    if (!rows.length) return []
    const sums = await db
      .select({ shiftId: receipts.shiftId, receipts: num(sql`count(*)`), revenue: num(sql`sum(${receipts.total})`) })
      .from(receipts)
      .where(and(inArray(receipts.shiftId, rows.map((r) => r.id)), eq(receipts.status, 'closed')))
      .groupBy(receipts.shiftId)
    const by = new Map(sums.map((s) => [s.shiftId, s]))
    return rows.map((r) => ({ ...r, receipts: by.get(r.id)?.receipts ?? 0, revenue: by.get(r.id)?.revenue ?? 0 }))
  })

  /**
   * Отчёт «Товары»: по каждому проданному товару — категория, отдел, количество, выручка,
   * себестоимость и прибыль. Угощение считается отдельно: его съели, но денег за него нет.
   */
  app.get('/api/reports/products', { preHandler: requirePerm('reports.view') }, async (req) => {
    const { start, end } = range(req.query)
    const tenantId = req.auth.tenantId
    const closed = and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'closed'), gte(receipts.closedAt, start), lt(receipts.closedAt, end))
    const paid = sql`${receiptItems.comp} = false`
    const rows = await db
      .select({
        productId: receiptItems.productId,
        name: sql<{ uz: string; ru: string }>`min(${receiptItems.name}::text)::jsonb`,
        categoryId: sql<string | null>`min(${products.categoryId}::text)`,
        departmentId: sql<string | null>`min(${receiptItems.departmentId}::text)`,
        qty: num(sql`sum(case when ${paid} then ${receiptItems.qty} else 0 end)`),
        amount: num(sql`sum(case when ${paid} then ${receiptItems.total} else 0 end)`),
        cost: num(sql`sum(round(${receiptItems.cost} * ${receiptItems.qty} / 1000.0))`),
        compQty: num(sql`sum(case when ${paid} then 0 else ${receiptItems.qty} end)`),
        receipts: num(sql`count(distinct ${receiptItems.receiptId})`),
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
      .leftJoin(products, eq(products.id, receiptItems.productId))
      .where(and(closed, isNull(receiptItems.voidedAt)))
      .groupBy(receiptItems.productId)
      .orderBy(desc(sql`sum(${receiptItems.total})`))
    const [cats, deps] = await Promise.all([
      db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.tenantId, tenantId)),
      db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.tenantId, tenantId)),
    ])
    return {
      rows: rows.map((p) => ({ ...p, profit: p.amount - p.cost })),
      categories: cats,
      departments: deps,
    }
  })

  /**
   * Отчёт «Заработная плата»: оклад за дни периода + процент от своих продаж + процент от обслуживания.
   * Оклад делится по дням: за каждый день периода — оклад / число дней в его месяце.
   * Продажи считаются без обслуживания, по закрытым чекам сотрудника.
   */
  app.get('/api/reports/salary', { preHandler: requirePerm('reports.view') }, async (req) => {
    const { start, end } = range(req.query)
    const { from, to } = rangeQuery.parse(req.query)
    const tenantId = req.auth.tenantId
    const staff = await db
      .select({
        id: users.id,
        name: users.name,
        roleName: schema.roles.name,
        active: users.active,
        deleted: sql<boolean>`${users.deletedAt} is not null`,
        salaryFixed: users.salaryFixed,
        salarySalesBp: users.salarySalesBp,
        salaryServiceBp: users.salaryServiceBp,
      })
      .from(users)
      .innerJoin(schema.roles, eq(schema.roles.id, users.roleId))
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.createdAt))
    const sales = await db
      .select({
        waiterId: receipts.waiterId,
        receipts: num(sql`count(*)`),
        sales: num(sql`sum(${receipts.total} - ${receipts.serviceAmount})`),
        service: num(sql`sum(${receipts.serviceAmount})`),
      })
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'closed'), gte(receipts.closedAt, start), lt(receipts.closedAt, end)))
      .groupBy(receipts.waiterId)
    const byUser = new Map(sales.map((s) => [s.waiterId, s]))
    // Доля месячного оклада, приходящаяся на период: сумма (1 / дней в месяце) по каждому дню.
    let share = 0
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
      share += 1 / new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    }
    const rows = staff
      .map((u) => {
        const s = byUser.get(u.id)
        const fixed = Math.round(u.salaryFixed * share)
        const fromSales = Math.round(((s?.sales ?? 0) * u.salarySalesBp) / 10_000)
        const fromService = Math.round(((s?.service ?? 0) * u.salaryServiceBp) / 10_000)
        return { ...u, receipts: s?.receipts ?? 0, sales: s?.sales ?? 0, service: s?.service ?? 0, fixed, fromSales, fromService, total: fixed + fromSales + fromService }
      })
      // Уволенных и выключенных показываем, только если им есть что начислить.
      .filter((u) => (!u.deleted && u.active) || u.total > 0 || u.receipts > 0)
    return { rows, days: Math.round((end.getTime() - start.getTime()) / 86_400_000) }
  })

  /** Отчёт «История»: журнал действий сотрудников за период — кто, когда и что сделал. */
  app.get('/api/reports/history', { preHandler: requirePerm('reports.view') }, async (req) => {
    const { start, end } = range(req.query)
    const q = z.object({ suspicious: z.enum(['0', '1']).default('0') }).parse(req.query)
    const tenantId = req.auth.tenantId
    const where = and(
      eq(auditLog.tenantId, tenantId),
      gte(auditLog.createdAt, start),
      lt(auditLog.createdAt, end),
      q.suspicious === '1' ? eq(auditLog.suspicious, true) : undefined,
    )
    const [{ total }] = await db.select({ total: num(sql`count(*)`) }).from(auditLog).where(where)
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        suspicious: auditLog.suspicious,
        data: auditLog.data,
        createdAt: auditLog.createdAt,
        userId: auditLog.userId,
        userName: users.name,
        receiptId: auditLog.receiptId,
        receiptNumber: receipts.number,
        tableName: tables.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .leftJoin(receipts, eq(receipts.id, auditLog.receiptId))
      .leftJoin(tables, eq(tables.id, receipts.tableId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(2000)
    return { total, rows }
  })

  // ───────────── Чеки ─────────────

  app.get('/api/receipts', { preHandler: requirePerm('sales.view') }, async (req) => {
    const { start, end } = range(req.query)
    const q = z
      .object({
        status: z.enum(['all', 'open', 'closed', 'cancelled', 'refunded']).default('all'),
        suspicious: z.enum(['0', '1']).default('0'),
        number: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query)
    const tenantId = req.auth.tenantId
    // В список попадают чеки, открытые в выбранные дни: так видны и ещё не закрытые.
    const where = and(
      eq(receipts.tenantId, tenantId),
      gte(receipts.openedAt, start),
      lt(receipts.openedAt, end),
      q.status === 'all' ? undefined : eq(receipts.status, q.status),
      q.suspicious === '1' ? eq(receipts.suspicious, true) : undefined,
      q.number ? eq(receipts.number, q.number) : undefined,
    )
    const [{ total }] = await db.select({ total: num(sql`count(*)`) }).from(receipts).where(where)
    const rows = await db
      .select({
        id: receipts.id,
        number: receipts.number,
        status: receipts.status,
        tableName: tables.name,
        saleType: saleTypes.name,
        waiterName: users.name,
        guests: receipts.guests,
        discountAmount: receipts.discountAmount,
        total: receipts.total,
        suspicious: receipts.suspicious,
        openedAt: receipts.openedAt,
        closedAt: receipts.closedAt,
      })
      .from(receipts)
      .leftJoin(tables, eq(tables.id, receipts.tableId))
      .leftJoin(saleTypes, eq(saleTypes.id, receipts.saleTypeId))
      .leftJoin(users, eq(users.id, receipts.waiterId))
      .where(where)
      .orderBy(desc(receipts.openedAt))
      .limit(500)
    const paid = rows.length
      ? await db
          .select({ receiptId: payments.receiptId, name: paymentMethods.name, amount: payments.amount })
          .from(payments)
          .innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId))
          .where(inArray(payments.receiptId, rows.map((r) => r.id)))
      : []
    const byReceipt = new Map<string, { name: { uz: string; ru: string }; amount: number }[]>()
    for (const p of paid) byReceipt.set(p.receiptId, [...(byReceipt.get(p.receiptId) ?? []), { name: p.name, amount: p.amount }])
    return { total, rows: rows.map((r) => ({ ...r, payments: byReceipt.get(r.id) ?? [] })) }
  })

  app.get('/api/receipts/:id', { preHandler: requirePerm('sales.view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const tenantId = req.auth.tenantId
    const [row] = await db
      .select({ r: receipts, tableName: tables.name, saleType: saleTypes.name, waiterName: users.name })
      .from(receipts)
      .leftJoin(tables, eq(tables.id, receipts.tableId))
      .leftJoin(saleTypes, eq(saleTypes.id, receipts.saleTypeId))
      .leftJoin(users, eq(users.id, receipts.waiterId))
      .where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)))
    if (!row) throw new HttpError(404, 'not_found')
    const [items, paid, history] = await Promise.all([
      db
        .select({
          id: receiptItems.id,
          name: receiptItems.name,
          price: receiptItems.price,
          qty: receiptItems.qty,
          total: receiptItems.total,
          comment: receiptItems.comment,
          voided: sql<boolean>`${receiptItems.voidedAt} is not null`,
          reason: reasons.name,
        })
        .from(receiptItems)
        .leftJoin(reasons, eq(reasons.id, receiptItems.reasonId))
        .where(eq(receiptItems.receiptId, id))
        .orderBy(asc(receiptItems.createdAt)),
      db
        .select({ name: paymentMethods.name, amount: payments.amount })
        .from(payments)
        .innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId))
        .where(eq(payments.receiptId, id))
        .orderBy(asc(payments.createdAt)),
      db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          suspicious: auditLog.suspicious,
          data: auditLog.data,
          createdAt: auditLog.createdAt,
          userName: users.name,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(eq(auditLog.receiptId, id))
        .orderBy(asc(auditLog.createdAt)),
    ])
    const r = row.r
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      tableName: row.tableName,
      saleType: row.saleType,
      waiterName: row.waiterName,
      guests: r.guests,
      comment: r.comment,
      subtotal: r.subtotal,
      discountKind: r.discountKind,
      discountValue: r.discountValue,
      discountAmount: r.discountAmount,
      serviceBp: r.serviceBp,
      serviceAmount: r.serviceAmount,
      total: r.total,
      suspicious: r.suspicious,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      items,
      payments: paid,
      history,
    }
  })
}
