import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { printSettings } from './pos.js'

const body = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(160).default(''),
  phone: z.string().trim().max(40).default(''),
  receiptHeader: z.string().trim().max(120).default(''),
  receiptFooter: z.string().trim().max(200).default(''),
  receiptShowWaiter: z.boolean().default(true),
  receiptShowGuests: z.boolean().default(true),
  receiptShowTime: z.boolean().default(true),
  printKitchen: z.boolean().default(true),
  printReceipt: z.boolean().default(true),
  /** Через сколько минут без новых позиций стол в зале краснеет; 0 — не краснеет (как «Изменение цвета стола» в Clopos) */
  tableRedMinutes: z.number().int().min(0).max(1000).default(0),
  /** Час начала рабочего дня (как в Clopos): продажи до этого часа относятся к прошлому дню. Не прислано — не меняется. */
  dayStartHour: z.number().int().min(0).max(12).optional(),
  /** Через сколько минут бездействия касса выходит на экран ПИН-кода; 0 — никогда. Не прислано — не меняется. */
  autoLogoutMinutes: z.number().int().min(0).max(240).optional(),
})

/** Час начала рабочего дня заведения: по умолчанию 06:00, как было в отчёте кассы. */
export const dayStartOf = (settings: unknown) => {
  const v = Number((settings as Record<string, unknown> | null)?.dayStartHour ?? 6)
  return Number.isInteger(v) && v >= 0 && v <= 12 ? v : 6
}
/** Автовыход кассы, минут: по умолчанию 5, как было раньше. */
export const autoLogoutOf = (settings: unknown) => {
  const v = Number((settings as Record<string, unknown> | null)?.autoLogoutMinutes ?? 5)
  return Number.isInteger(v) && v >= 0 && v <= 240 ? v : 5
}

const reasonName = z
  .object({ uz: z.string().trim().max(80).default(''), ru: z.string().trim().max(80).default('') })
  .refine((v) => v.uz.length > 0 || v.ru.length > 0, { message: 'name_required' })
  .transform((v) => ({ uz: v.uz || v.ru, ru: v.ru || v.uz }))

export function settingsRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const guard = { preHandler: requirePerm('settings.edit') }
  const { tenants } = schema

  async function load(tenantId: string) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
    if (!t) throw new HttpError(404, 'not_found')
    const p = printSettings(t.settings)
    return {
      name: t.name,
      address: p.address,
      phone: p.phone,
      receiptHeader: p.header,
      receiptFooter: p.footer,
      receiptShowWaiter: p.showWaiter,
      receiptShowGuests: p.showGuests,
      receiptShowTime: p.showTime,
      printKitchen: p.kitchen,
      printReceipt: p.receipt,
      tableRedMinutes: Number((t.settings as Record<string, unknown>).tableRedMinutes ?? 0) || 0,
      dayStartHour: dayStartOf(t.settings),
      autoLogoutMinutes: autoLogoutOf(t.settings),
    }
  }

  app.get('/api/settings', guard, async (req) => load(req.auth.tenantId))

  app.patch('/api/settings', guard, async (req) => {
    const { name, ...rest } = body.parse(req.body)
    const tenantId = req.auth.tenantId
    const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId))
    if (!t) throw new HttpError(404, 'not_found')
    // Остальные ключи настроек не трогаем: позже здесь появятся и другие разделы.
    await db
      .update(tenants)
      // Чего не прислали (старая версия панели) — оставляем как было.
      .set({ name, settings: { ...t.settings, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) } })
      .where(eq(tenants.id, tenantId))
    return load(tenantId)
  })

  // ───────────── Причины удаления позиции (выбираются на кассе) ─────────────
  const { reasons } = schema
  const idParam = z.object({ id: z.string().uuid() })

  app.get('/api/reasons', guard, async (req) =>
    db
      .select({ id: reasons.id, name: reasons.name, active: reasons.active })
      .from(reasons)
      .where(and(eq(reasons.tenantId, req.auth.tenantId), eq(reasons.kind, 'void')))
      .orderBy(asc(reasons.id)),
  )

  app.post('/api/reasons', guard, async (req) => {
    const { name } = z.object({ name: reasonName }).parse(req.body)
    const [row] = await db.insert(reasons).values({ tenantId: req.auth.tenantId, kind: 'void', name }).returning({ id: reasons.id, name: reasons.name, active: reasons.active })
    return row
  })

  // Причину не удаляем, а выключаем: она остаётся в старых чеках и отчётах.
  app.patch('/api/reasons/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ name: reasonName, active: z.boolean() }).parse(req.body)
    const tenantId = req.auth.tenantId
    if (!body.active) {
      const live = await db.select({ id: reasons.id }).from(reasons).where(and(eq(reasons.tenantId, tenantId), eq(reasons.kind, 'void'), eq(reasons.active, true)))
      // Без единой причины кассир не сможет удалить позицию.
      if (live.length === 1 && live[0].id === id) throw new HttpError(400, 'last_reason')
    }
    const [row] = await db
      .update(reasons)
      .set(body)
      .where(and(eq(reasons.id, id), eq(reasons.tenantId, tenantId), eq(reasons.kind, 'void')))
      .returning({ id: reasons.id, name: reasons.name, active: reasons.active })
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })
}
