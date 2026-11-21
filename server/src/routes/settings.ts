import { eq } from 'drizzle-orm'
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
})

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
      .set({ name, settings: { ...t.settings, ...rest } })
      .where(eq(tenants.id, tenantId))
    return load(tenantId)
  })
}
