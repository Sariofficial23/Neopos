import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { brandMedia, tenants, users, roles } = schema

const kindParam = z.object({ kind: z.enum(['logo', 'photo']) })
/** Картинку сжимает панель перед отправкой; здесь только проверяем тип и размер. */
const MAX_BYTES = { logo: 300_000, photo: 2_000_000 } as const
const dataUrl = z.string().regex(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'bad_image')

export type BrandImages = { logo: string | null; photo: string | null }

/**
 * Ссылки на картинки бренда. В адресе — время изменения: браузер и касса держат картинку в кэше,
 * а после замены сразу берут новую.
 */
export async function brandImages(db: DB, tenantId: string): Promise<BrandImages> {
  const rows = await db
    .select({ kind: brandMedia.kind, updatedAt: brandMedia.updatedAt })
    .from(brandMedia)
    .where(eq(brandMedia.tenantId, tenantId))
  const url = (kind: string) => {
    const r = rows.find((x) => x.kind === kind)
    return r ? `/api/media/${tenantId}/${kind}?v=${r.updatedAt.getTime()}` : null
  }
  return { logo: url('logo'), photo: url('photo') }
}

export function brandRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const edit = { preHandler: requirePerm('settings.edit') }

  app.get('/api/brand', edit, async (req) => brandImages(db, req.auth.tenantId))

  app.put('/api/brand/:kind', { ...edit, bodyLimit: 4_000_000 }, async (req) => {
    const { kind } = kindParam.parse(req.params)
    const { image } = z.object({ image: dataUrl }).parse(req.body)
    const [, mime, data] = /^data:(image\/[a-z]+);base64,(.*)$/.exec(image)!
    if (Buffer.byteLength(data, 'base64') > MAX_BYTES[kind]) throw new HttpError(413, 'image_too_big')
    await db
      .insert(brandMedia)
      .values({ tenantId: req.auth.tenantId, kind, mime, data })
      .onConflictDoUpdate({ target: [brandMedia.tenantId, brandMedia.kind], set: { mime, data, updatedAt: new Date() } })
    return brandImages(db, req.auth.tenantId)
  })

  app.delete('/api/brand/:kind', edit, async (req) => {
    const { kind } = kindParam.parse(req.params)
    await db.delete(brandMedia).where(and(eq(brandMedia.tenantId, req.auth.tenantId), eq(brandMedia.kind, kind)))
    return brandImages(db, req.auth.tenantId)
  })

  // Сама картинка: открыта без входа (её показывает экран ПИН-кода), кэшируется надолго — адрес меняется при замене.
  app.get('/api/media/:tenantId/:kind', async (req, reply) => {
    const { tenantId, kind } = z.object({ tenantId: z.string().uuid(), kind: z.enum(['logo', 'photo']) }).parse(req.params)
    const [row] = await db
      .select({ mime: brandMedia.mime, data: brandMedia.data })
      .from(brandMedia)
      .where(and(eq(brandMedia.tenantId, tenantId), eq(brandMedia.kind, kind)))
    if (!row) throw new HttpError(404, 'not_found')
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(Buffer.from(row.data, 'base64'))
  })

  /**
   * Экран ПИН-кода до входа сотрудника: название, логотип, фото заведения и язык владельца.
   * Нужен только токен устройства.
   */
  app.get('/api/pos/device', async (req) => {
    let device: { kind?: string; tid: string; did?: string }
    try {
      device = app.jwt.verify(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    } catch {
      throw new HttpError(401, 'device_not_activated')
    }
    if (device.kind !== 'device') throw new HttpError(401, 'device_not_activated')
    const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, device.tid))
    if (!tenant) throw new HttpError(401, 'device_not_activated')
    const [owner] = await db
      .select({ lang: users.lang })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, device.tid), eq(roles.isOwner, true)))
      .limit(1)
    return { venue: tenant.name, lang: owner?.lang ?? 'uz', ...(await brandImages(db, device.tid)) }
  })
}
