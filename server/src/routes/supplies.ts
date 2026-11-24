import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { supplies, supplyItems, products, users, categories } = schema

const idParam = z.object({ id: z.string().uuid() })
const body = z.object({
  supplier: z.string().trim().max(120).default(''),
  note: z.string().trim().max(300).nullish(),
  date: z.string().datetime({ offset: true }).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        /** Количество в тысячных: 1000 = 1 шт */
        qty: z.number().int().min(1).max(100_000_000),
        /** Цена закупки за единицу, сум */
        cost: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(300),
})

/**
 * «Приход товаров» для штучных товаров: накладная увеличивает остаток и пересчитывает себестоимость.
 * Себестоимость — средняя взвешенная: (остаток × старая цена + приход × новая цена) / новый остаток.
 * Если остатка не было (или он ушёл в минус), себестоимостью становится цена прихода.
 */
export function supplyRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const view = { preHandler: requirePerm('menu.view') }
  const edit = { preHandler: requirePerm('menu.edit') }

  app.get('/api/supplies', view, async (req) => {
    const tenantId = req.auth.tenantId
    const rows = await db
      .select({
        id: supplies.id,
        number: supplies.number,
        supplier: supplies.supplier,
        note: supplies.note,
        total: supplies.total,
        date: supplies.date,
        userName: users.name,
        positions: sql<number>`(select count(*) from supply_items si where si.supply_id = ${supplies.id})::int`.mapWith(Number),
      })
      .from(supplies)
      .leftJoin(users, eq(users.id, supplies.createdBy))
      .where(eq(supplies.tenantId, tenantId))
      .orderBy(desc(supplies.date), desc(supplies.number))
      .limit(500)
    return rows
  })

  app.get('/api/supplies/:id', view, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const [s] = await db.select().from(supplies).where(and(eq(supplies.id, id), eq(supplies.tenantId, tenantId)))
    if (!s) throw new HttpError(404, 'not_found')
    const items = await db
      .select({ id: supplyItems.id, productId: supplyItems.productId, name: products.name, qty: supplyItems.qty, cost: supplyItems.cost, total: supplyItems.total })
      .from(supplyItems)
      .innerJoin(products, eq(products.id, supplyItems.productId))
      .where(eq(supplyItems.supplyId, id))
    return { ...s, items }
  })

  app.post('/api/supplies', edit, async (req) => {
    const data = body.parse(req.body)
    const tenantId = req.auth.tenantId
    // Один товар в накладной — одна строка: одинаковые складываем, цену берём средней по строкам.
    const merged = new Map<string, { qty: number; sum: number }>()
    for (const i of data.items) {
      const cur = merged.get(i.productId) ?? { qty: 0, sum: 0 }
      cur.qty += i.qty
      cur.sum += Math.round((i.cost * i.qty) / 1000)
      merged.set(i.productId, cur)
    }
    return db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), inArray(products.id, [...merged.keys()]), isNull(products.deletedAt)))
      if (found.length !== merged.size) throw new HttpError(400, 'bad_product')
      // Приход ведём только для штучных товаров.
      if (found.some((p) => p.unit !== 'pcs' || p.byWeight)) throw new HttpError(400, 'supply_only_pieces')

      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${supplies.number}), 0)::int`.mapWith(Number) })
        .from(supplies)
        .where(eq(supplies.tenantId, tenantId))
      const lines = found.map((p) => {
        const m = merged.get(p.id)!
        return { product: p, qty: m.qty, total: m.sum, cost: Math.round((m.sum * 1000) / m.qty) }
      })
      const [s] = await tx
        .insert(supplies)
        .values({
          tenantId,
          number: max + 1,
          supplier: data.supplier,
          note: data.note || null,
          total: lines.reduce((a, l) => a + l.total, 0),
          createdBy: req.auth.userId,
          ...(data.date ? { date: new Date(data.date) } : {}),
        })
        .returning()
      await tx.insert(supplyItems).values(lines.map((l) => ({ tenantId, supplyId: s.id, productId: l.product.id, qty: l.qty, cost: l.cost, total: l.total })))
      for (const l of lines) {
        const old = l.product.trackStock ? l.product.stock : 0
        const newStock = old + l.qty
        // Средняя взвешенная; при нулевом или отрицательном остатке — просто цена прихода.
        const cost = old > 0 ? Math.round((old * l.product.cost + l.qty * l.cost) / newStock) : l.cost
        await tx.update(products).set({ trackStock: true, stock: newStock, cost }).where(eq(products.id, l.product.id))
      }
      return { id: s.id, number: s.number }
    })
  })

  // Удаление прихода (ошиблись при вводе): остаток уменьшается обратно. Себестоимость не пересчитываем назад.
  app.delete('/api/supplies/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    return db.transaction(async (tx) => {
      const [s] = await tx.select({ id: supplies.id }).from(supplies).where(and(eq(supplies.id, id), eq(supplies.tenantId, tenantId)))
      if (!s) throw new HttpError(404, 'not_found')
      const items = await tx.select({ productId: supplyItems.productId, qty: supplyItems.qty }).from(supplyItems).where(eq(supplyItems.supplyId, id))
      for (const i of items) await tx.update(products).set({ stock: sql`${products.stock} - ${i.qty}` }).where(eq(products.id, i.productId))
      await tx.delete(supplies).where(eq(supplies.id, id))
      return { ok: true }
    })
  })

  /** Остатки: товары с учётом, их количество, себестоимость и стоимость остатка. */
  app.get('/api/stock', view, async (req) => {
    const tenantId = req.auth.tenantId
    const rows = await db
      .select({ id: products.id, name: products.name, category: categories.name, price: products.price, cost: products.cost, stock: products.stock, trackStock: products.trackStock, unit: products.unit, byWeight: products.byWeight })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .orderBy(asc(products.sort), asc(products.createdAt))
    const pieces = rows.filter((p) => p.unit === 'pcs' && !p.byWeight)
    return {
      /** Все штучные товары — для выбора в накладной */
      products: pieces.map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price, cost: p.cost, stock: p.stock, trackStock: p.trackStock })),
      /** Стоимость остатков по себестоимости */
      value: pieces.filter((p) => p.trackStock && p.stock > 0).reduce((a, p) => a + Math.round((p.stock * p.cost) / 1000), 0),
    }
  })
}

/**
 * Изменяет остаток товаров чека: при оплате списывает (sign = -1), при возврате и повторном открытии возвращает (+1).
 * Затрагивает только товары с включённым учётом; угощение тоже списывается — его съели.
 */
export async function adjustStockForReceipt(tx: Parameters<Parameters<DB['transaction']>[0]>[0], receiptId: string, sign: 1 | -1) {
  const { receiptItems } = schema
  const items = await tx
    .select({ productId: receiptItems.productId, qty: sql<number>`sum(${receiptItems.qty})::int`.mapWith(Number) })
    .from(receiptItems)
    .where(and(eq(receiptItems.receiptId, receiptId), isNull(receiptItems.voidedAt)))
    .groupBy(receiptItems.productId)
  for (const i of items) {
    if (!i.productId) continue
    await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${sign * i.qty}` })
      .where(and(eq(products.id, i.productId), eq(products.trackStock, true)))
  }
}
