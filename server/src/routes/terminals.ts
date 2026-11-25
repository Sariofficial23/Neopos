import { and, asc, eq, lt, ne, or, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'

const { terminals, branches, users, roles } = schema

const idParam = z.object({ id: z.string().uuid() })
/** Пароль терминала — как в Clopos: короткий код из цифр или букв, который вводят на кассе. */
const password = z.string().trim().regex(/^[0-9A-Za-z]{4,16}$/, 'bad_terminal_password')
const body = z.object({
  name: z.string().trim().min(1).max(60),
  password,
  active: z.boolean().default(true),
})

/** Терминал «онлайн», если касса выходила на связь за последние 2 минуты. */
const ONLINE_MS = 2 * 60_000

/**
 * «Терминалы» в панели: владелец создаёт кассы и задаёт им пароли.
 * На кассе вводят бренд (логин владельца) и пароль терминала.
 */
export function terminalRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)
  const edit = { preHandler: requirePerm('settings.edit') }

  async function assertPasswordFree(tenantId: string, value: string, exceptId?: string) {
    const cond = and(eq(terminals.tenantId, tenantId), eq(terminals.password, value))
    const [taken] = await db
      .select({ id: terminals.id })
      .from(terminals)
      .where(exceptId ? and(cond, ne(terminals.id, exceptId)) : cond)
    if (taken) throw new HttpError(409, 'terminal_password_taken')
  }

  app.get('/api/terminals', edit, async (req) => {
    const tenantId = req.auth.tenantId
    const rows = await db
      .select({ id: terminals.id, name: terminals.name, password: terminals.password, active: terminals.active, lastSeenAt: terminals.lastSeenAt, syncAt: terminals.syncAt, createdAt: terminals.createdAt })
      .from(terminals)
      .where(eq(terminals.tenantId, tenantId))
      .orderBy(asc(terminals.createdAt))
    // Бренд для входа на кассе — логин владельца заведения.
    const [owner] = await db
      .select({ login: users.login })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, tenantId), eq(roles.isOwner, true)))
      .limit(1)
    const now = Date.now()
    return {
      brand: owner?.login ?? null,
      terminals: rows.map((r, i) => ({
        ...r,
        number: i + 1,
        online: !!r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_MS,
        // Главный терминал (локальная сеть): обменивался с облаком за последнюю неделю; «на связи» — за последние три минуты.
        main: !!r.syncAt && now - r.syncAt.getTime() < 7 * 86_400_000,
        syncOnline: !!r.syncAt && now - r.syncAt.getTime() < 3 * 60_000,
      })),
    }
  })

  app.post('/api/terminals', edit, async (req) => {
    const data = body.parse(req.body)
    const tenantId = req.auth.tenantId
    await assertPasswordFree(tenantId, data.password)
    const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.createdAt)).limit(1)
    if (!branch) throw new HttpError(500, 'internal')
    const [row] = await db
      .insert(terminals)
      .values({ tenantId, branchId: branch.id, code: crypto.randomUUID(), ...data })
      .returning({ id: terminals.id })
    return row
  })

  app.patch('/api/terminals/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const data = body.parse(req.body)
    await assertPasswordFree(req.auth.tenantId, data.password, id)
    const [row] = await db
      .update(terminals)
      .set(data)
      .where(and(eq(terminals.id, id), eq(terminals.tenantId, req.auth.tenantId)))
      .returning({ id: terminals.id })
    if (!row) throw new HttpError(404, 'not_found')
    return row
  })

  // Удалённый терминал сразу перестаёт пускать сотрудников: касса вернётся на экран подключения.
  app.delete('/api/terminals/:id', edit, async (req) => {
    const { id } = idParam.parse(req.params)
    const [row] = await db
      .delete(terminals)
      .where(and(eq(terminals.id, id), eq(terminals.tenantId, req.auth.tenantId)))
      .returning({ id: terminals.id })
    if (!row) throw new HttpError(404, 'not_found')
    return { ok: true }
  })

  /**
   * Кассы заведения и их связь — для окна «Локальная сеть» на самой кассе: видно, какие кассы подключены.
   * Нужен только токен устройства (окно открывается и с экрана ПИН-кода). Показываем кассы, бывшие на связи за неделю.
   */
  app.get('/api/pos/terminals', async (req) => {
    let device: { kind?: string; tid: string; did?: string }
    try {
      device = app.jwt.verify(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    } catch {
      throw new HttpError(401, 'device_not_activated')
    }
    if (device.kind !== 'device' || !device.did) throw new HttpError(401, 'device_not_activated')
    const rows = await db
      .select({ id: terminals.id, name: terminals.name, lastSeenAt: terminals.lastSeenAt, syncAt: terminals.syncAt })
      .from(terminals)
      .where(and(eq(terminals.tenantId, device.tid), eq(terminals.active, true)))
    const now = Date.now()
    // На главном терминале «главный» — тот, чьим токеном идёт обмен с облаком; в облаке — тот, кто недавно обменивался.
    let mainId: string | null = null
    if (process.env.NEOPOS_LOCAL === '1') {
      try {
        mainId = JSON.parse(Buffer.from(String(process.env.SYNC_TOKEN).split('.')[1], 'base64url').toString()).did ?? null
      } catch {
        mainId = null
      }
    }
    return rows
      .filter((t) => t.id === device.did || t.id === mainId || (t.lastSeenAt && now - t.lastSeenAt.getTime() < 7 * 86_400_000))
      .map((t) => ({
        id: t.id,
        name: t.name,
        lastSeenAt: t.lastSeenAt,
        online: !!t.lastSeenAt && now - t.lastSeenAt.getTime() < ONLINE_MS,
        me: t.id === device.did,
        main: mainId ? t.id === mainId : !!t.syncAt && now - t.syncAt.getTime() < 3 * 60_000,
      }))
      .sort((a, b) => Number(b.main) - Number(a.main) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  })

  /** Касса раз в минуту сообщает, что она на связи: по этому в панели горит «Онлайн». Нужен токен устройства. */
  app.post('/api/pos/ping', async (req) => {
    let device: { kind?: string; tid: string; did?: string }
    try {
      device = app.jwt.verify(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    } catch {
      throw new HttpError(401, 'device_not_activated')
    }
    if (device.kind !== 'device' || !device.did) throw new HttpError(401, 'device_not_activated')
    const now = new Date()
    // Пишем в базу не чаще раза в 30 секунд на терминал.
    await db
      .update(terminals)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(terminals.id, device.did),
          eq(terminals.tenantId, device.tid),
          or(isNull(terminals.lastSeenAt), lt(terminals.lastSeenAt, new Date(now.getTime() - 30_000))),
        ),
      )
    const [t] = await db.select({ active: terminals.active }).from(terminals).where(and(eq(terminals.id, device.did), eq(terminals.tenantId, device.tid)))
    if (!t || !t.active) throw new HttpError(401, 'device_not_activated')
    return { ok: true }
  })
}
