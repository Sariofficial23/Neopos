import { and, asc, count, eq, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { paymentMethods, payments } = schema

const idParam = z.object({ id: z.string().uuid() })
const name = z
  .object({ uz: z.string().trim().max(40).default(''), ru: z.string().trim().max(40).default('') })
  .refine((v) => v.uz.length > 0 || v.ru.length > 0, { message: 'name_required' })
  .transform((v) => ({ uz: v.uz || v.ru, ru: v.ru || v.uz }))
/** cash — наличные (с них даётся сдача), card — карта, transfer — перевод (Click, Payme…), other — прочее */
const body = z.object({
  name,
  kind: z.enum(['cash', 'card', 'transfer', 'other']),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(1000).default(0),
})

/** Способы оплаты заведения: владелец добавляет и выключает их в панели, касса показывает только включённые. */
export function paymentMethodRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const edit = { preHandler: requirePerm('settings.edit') }

  const list = (tenantId: string) =>
    db.select().from(paymentMethods).where(eq(paymentMethods.tenantId, tenantId)).orderBy(asc(paymentMethods.sort), asc(paymentMethods.id))

  /** Хотя бы один способ оплаты должен остаться включённым, иначе чек не закрыть. */
  async function assertOneActiveLeft(tenantId: string, exceptId: string) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.active, true), ne(paymentMethods.id, exceptId)))
    if (n === 0) throw new HttpError(409, 'last_payment_method')
  }

  app.get('/api/payment-methods', edit, async (req) => list(req.auth.tenantId))

  app.post('/api/payment-methods', edit, async (req) => {
    const data = body.parse(req.body)
    const [row] = await db
      .insert(paymentMethods)
      .values({ tenantId: req.auth.tenantId, ...data })
      .returning()
    return row
  })

  app.patch('/api/payment-methods/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const data = body.parse(req.body)
    if (!data.active) await assertOneActiveLeft(req.auth.tenantId, id)
    const [row] = await db
      .update(paymentMethods)
      .set(data)
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.tenantId, req.auth.tenantId)))
      .returning()
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  // Удалить можно только способ, которым ещё не платили; иначе его выключают — история оплат сохраняется.
  app.delete('/api/payment-methods/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const tenantId = req.auth.tenantId
    const [{ n }] = await db.select({ n: count() }).from(payments).where(eq(payments.methodId, id))
    if (n > 0) throw new HttpError(409, 'payment_method_used')
    await assertOneActiveLeft(tenantId, id)
    const [row] = await db
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.tenantId, tenantId)))
      .returning({ id: paymentMethods.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })
}
