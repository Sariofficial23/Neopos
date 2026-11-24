import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { tenants, subscriptionPayments, platformAdmins } = schema

const idParam = z.object({ id: z.string().uuid() })

/**
 * Абонентская плата. Владелец видит в панели тариф, сумму, дату следующего платежа и историю.
 * Тариф и платежи вносит администратор NeoPos в админ-панели: онлайн-оплаты пока нет.
 */
export function subscriptionRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)

  async function requireAdmin(req: FastifyRequest) {
    try {
      await req.jwtVerify()
    } catch {
      throw new HttpError(401, 'unauthorized')
    }
    if (req.user.kind !== 'admin' || !req.user.sub) throw new HttpError(401, 'unauthorized')
    const [admin] = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.id, req.user.sub))
    if (!admin) throw new HttpError(401, 'unauthorized')
  }
  const admin = { preHandler: requireAdmin }

  async function overview(tenantId: string) {
    const [t] = await db
      .select({ tariff: tenants.tariff, monthlyFee: tenants.monthlyFee, nextPaymentAt: tenants.nextPaymentAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    if (!t) throw new HttpError(404, 'not_found')
    const payments = await db
      .select({ id: subscriptionPayments.id, amount: subscriptionPayments.amount, method: subscriptionPayments.method, note: subscriptionPayments.note, createdAt: subscriptionPayments.createdAt })
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.tenantId, tenantId))
      .orderBy(desc(subscriptionPayments.createdAt))
      .limit(200)
    return { ...t, overdue: !!t.nextPaymentAt && t.nextPaymentAt.getTime() < Date.now(), payments }
  }

  // Панель заведения
  app.get('/api/subscription', { preHandler: requirePerm('settings.edit') }, async (req) => overview(req.auth.tenantId))

  // Админ-панель NeoPos
  app.get('/api/admin/tenants/:id/subscription', admin, async (req) => overview(idParam.parse(req.params).id))

  app.patch('/api/admin/tenants/:id/subscription', admin, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({
        tariff: z.string().trim().min(1).max(40),
        monthlyFee: z.number().int().min(0).max(1_000_000_000),
        nextPaymentAt: z.string().datetime({ offset: true }).nullable(),
      })
      .parse(req.body)
    const [row] = await db
      .update(tenants)
      .set({ tariff: body.tariff, monthlyFee: body.monthlyFee, nextPaymentAt: body.nextPaymentAt ? new Date(body.nextPaymentAt) : null })
      .where(eq(tenants.id, id))
      .returning({ id: tenants.id })
    if (!row) throw new HttpError(404, 'not_found')
    return overview(id)
  })

  /** Платёж получен: записываем его и сдвигаем дату следующего платежа на оплаченные месяцы. */
  app.post('/api/admin/tenants/:id/subscription/payments', admin, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z
      .object({
        amount: z.number().int().min(1).max(1_000_000_000),
        method: z.string().trim().max(40).default(''),
        note: z.string().trim().max(200).nullish(),
        months: z.number().int().min(0).max(36).default(1),
      })
      .parse(req.body)
    const [t] = await db.select({ nextPaymentAt: tenants.nextPaymentAt }).from(tenants).where(eq(tenants.id, id))
    if (!t) throw new HttpError(404, 'not_found')
    await db.insert(subscriptionPayments).values({ tenantId: id, amount: body.amount, method: body.method, note: body.note || null })
    if (body.months > 0) {
      // Оплата вперёд продлевает от текущей даты платежа; просроченная — от сегодняшнего дня.
      const from = t.nextPaymentAt && t.nextPaymentAt.getTime() > Date.now() ? new Date(t.nextPaymentAt) : new Date()
      from.setMonth(from.getMonth() + body.months)
      await db.update(tenants).set({ nextPaymentAt: from }).where(eq(tenants.id, id))
    }
    return overview(id)
  })

  app.delete('/api/admin/tenants/:id/subscription/payments/:paymentId', admin, async (req) => {
    const { id, paymentId } = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() }).parse(req.params)
    await db.delete(subscriptionPayments).where(and(eq(subscriptionPayments.id, paymentId), eq(subscriptionPayments.tenantId, id)))
    return overview(id)
  })
}
