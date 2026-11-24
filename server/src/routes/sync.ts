import { and, eq, getTableColumns, gte, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { HttpError, pinKey, setPinKey } from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { adjustStockForReceipt } from './supplies.js'

/**
 * Обмен данными между главным терминалом заведения (локальный сервер) и облаком.
 * Описание и этапы — docs/LOCAL-NETWORK.md.
 *
 * У каждой таблицы один хозяин:
 *   настройки (меню, сотрудники, залы…) — облако, локальный сервер их только забирает;
 *   продажи (смены, чеки, оплаты…)       — локальный сервер, облако их только принимает.
 */

const s = schema
type Row = Record<string, unknown>
type AnyTable = PgTable & { id: any; tenantId?: any }

/** Настройки: порядок важен — сначала то, на что ссылаются остальные. */
const CONFIG: [string, AnyTable][] = [
  ['branches', s.branches],
  ['roles', s.roles],
  ['users', s.users],
  ['departments', s.departments],
  ['categories', s.categories],
  ['products', s.products],
  ['halls', s.halls],
  ['tables', s.tables],
  ['saleTypes', s.saleTypes],
  ['paymentMethods', s.paymentMethods],
  ['reasons', s.reasons],
  ['financeCategories', s.financeCategories],
  ['printers', s.printers],
  ['terminals', s.terminals],
]
/** Продажи: тоже в порядке ссылок. */
const SALES: [string, AnyTable][] = [
  ['shifts', s.shifts],
  ['receipts', s.receipts],
  ['receiptItems', s.receiptItems],
  ['payments', s.payments],
  ['cashMovements', s.cashMovements],
  ['auditLog', s.auditLog],
]

/** Режим локального сервера (главный терминал). */
export const isLocal = () => process.env.NEOPOS_LOCAL === '1'

// ───────────── Нумерация чеков и смен на локальном сервере ─────────────

/** До какого номера чеки и смены уже есть в облаке: локальная нумерация продолжается после него. */
const bases = new Map<string, { receipt: number; shift: number }>()
export const numberBase = (kind: 'receipt' | 'shift', tenantId: string) => bases.get(tenantId)?.[kind] ?? 0

// ───────────── Общие помощники ─────────────

/** JSON превращает даты в строки; перед записью в базу возвращаем их обратно. */
function reviveRows(table: AnyTable, rows: Row[]): Row[] {
  const cols = getTableColumns(table) as Record<string, { dataType: string }>
  const dateKeys = Object.keys(cols).filter((k) => cols[k].dataType === 'date')
  return rows.map((r) => {
    const out: Row = {}
    for (const k of Object.keys(cols)) if (k in r) out[k] = r[k]
    for (const k of dateKeys) if (typeof out[k] === 'string') out[k] = new Date(out[k] as string)
    return out
  })
}

/** Вставка или обновление по id. Строки с пустым parentId идут первыми (ссылки внутри таблицы). */
async function upsert(conn: Pick<DB, 'insert'>, table: AnyTable, rows: Row[]) {
  if (!rows.length) return
  const cols = getTableColumns(table) as Record<string, { name: string }>
  const set: Record<string, unknown> = {}
  for (const [key, col] of Object.entries(cols)) if (key !== 'id') set[key] = sql.raw(`excluded."${col.name}"`)
  const ordered = [...reviveRows(table, rows)].sort((a, b) => Number(a.parentId != null) - Number(b.parentId != null))
  for (let i = 0; i < ordered.length; i += 200) {
    await conn
      .insert(table)
      .values(ordered.slice(i, i + 200) as never)
      .onConflictDoUpdate({
        target: table.id,
        set: set as never,
        // Строку другого заведения перезаписать нельзя, даже зная её id.
        ...(table.tenantId ? { setWhere: sql`${table.tenantId} = excluded."tenant_id"` } : {}),
      })
  }
}

// ───────────── Облако: что отдаём и что принимаем ─────────────

const pushBody = z.object({
  shifts: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  receipts: z.array(z.record(z.string(), z.unknown())).max(5000).default([]),
  receiptItems: z.array(z.record(z.string(), z.unknown())).max(50_000).default([]),
  payments: z.array(z.record(z.string(), z.unknown())).max(20_000).default([]),
  cashMovements: z.array(z.record(z.string(), z.unknown())).max(5000).default([]),
  auditLog: z.array(z.record(z.string(), z.unknown())).max(100_000).default([]),
})

export function syncRoutes(app: FastifyInstance, db: DB) {
  /** Обмен ведёт главный терминал: нужен его токен устройства, терминал включён, заведение не заблокировано. */
  async function deviceTenant(req: FastifyRequest): Promise<string> {
    let device: { kind?: string; tid: string; did?: string }
    try {
      device = app.jwt.verify(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    } catch {
      throw new HttpError(401, 'device_not_activated')
    }
    if (device.kind !== 'device' || !device.did) throw new HttpError(401, 'device_not_activated')
    const [terminal] = await db
      .select({ active: s.terminals.active })
      .from(s.terminals)
      .where(and(eq(s.terminals.id, device.did), eq(s.terminals.tenantId, device.tid)))
    if (!terminal?.active) throw new HttpError(401, 'device_not_activated')
    return device.tid
  }

  // Состояние обмена — для значка на кассе. Ничего секретного.
  app.get('/api/sync/status', async () => {
    if (!isLocal()) return { mode: 'cloud', ...localState }
    // Сколько чеков открыто или закрыто после последней удачной отправки в облако.
    const [{ n }] =
      localTenant && !localState.online
        ? await db
            .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
            .from(s.receipts)
            .where(and(eq(s.receipts.tenantId, localTenant), lastPush ? or(gte(s.receipts.openedAt, lastPush), gte(s.receipts.closedAt, lastPush)) : undefined))
        : [{ n: 0 }]
    return { mode: 'local', ...localState, pendingReceipts: n }
  })

  if (isLocal()) {
    /**
     * Приложение на главном терминале получает токен устройства для своей кассы: предъявляет облачный
     * токен, которым ведётся обмен. Только с этого же компьютера.
     */
    app.post('/api/sync/adopt', async (req) => {
      const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
      const loopback = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
      if (!loopback || !process.env.SYNC_TOKEN || token !== process.env.SYNC_TOKEN) throw new HttpError(401, 'unauthorized')
      const claims = app.jwt.decode<{ kind?: string; tid?: string; did?: string }>(token)
      if (claims?.kind !== 'device' || !claims.tid || !claims.did) throw new HttpError(401, 'unauthorized')
      const [terminal] = await db
        .select({ id: s.terminals.id })
        .from(s.terminals)
        .where(and(eq(s.terminals.id, claims.did), eq(s.terminals.tenantId, claims.tid)))
      if (!terminal) throw new HttpError(409, 'not_synced')
      return { deviceToken: app.jwt.sign({ kind: 'device', tid: claims.tid, did: claims.did }) }
    })
    return
  }

  app.get('/api/sync/pull', async (req) => {
    const tenantId = await deviceTenant(req)
    const [tenant] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId))
    if (!tenant) throw new HttpError(404, 'not_found')
    const tables: Record<string, Row[]> = {}
    for (const [name, table] of CONFIG) tables[name] = (await db.select().from(table).where(eq(table.tenantId, tenantId))) as Row[]

    const [{ receipt }] = await db
      .select({ receipt: sql<number>`coalesce(max(${s.receipts.number}), 0)::int`.mapWith(Number) })
      .from(s.receipts)
      .where(eq(s.receipts.tenantId, tenantId))
    const [{ shift }] = await db
      .select({ shift: sql<number>`coalesce(max(${s.shifts.number}), 0)::int`.mapWith(Number) })
      .from(s.shifts)
      .where(eq(s.shifts.tenantId, tenantId))

    // Открытая смена с её чеками — чтобы главный терминал при первом запуске продолжил с того же места.
    const seed: Record<string, Row[]> = {}
    const open = await db.select().from(s.shifts).where(and(eq(s.shifts.tenantId, tenantId), isNull(s.shifts.closedAt)))
    seed.shifts = open as Row[]
    const shiftIds = open.map((x) => x.id)
    const rcpts = shiftIds.length ? await db.select().from(s.receipts).where(inArray(s.receipts.shiftId, shiftIds)) : []
    seed.receipts = rcpts as Row[]
    const rids = rcpts.map((x) => x.id)
    seed.receiptItems = (rids.length ? await db.select().from(s.receiptItems).where(inArray(s.receiptItems.receiptId, rids)) : []) as Row[]
    seed.payments = (rids.length ? await db.select().from(s.payments).where(inArray(s.payments.receiptId, rids)) : []) as Row[]
    seed.cashMovements = (shiftIds.length ? await db.select().from(s.cashMovements).where(inArray(s.cashMovements.shiftId, shiftIds)) : []) as Row[]

    // Логотип и фото заведения тяжёлые — отдаём только по запросу (?media=1).
    const media = (req.query as { media?: string }).media === '1' ? ((await db.select().from(s.brandMedia).where(eq(s.brandMedia.tenantId, tenantId))) as Row[]) : null
    return { tenant, pinKey: pinKey(tenantId), tables, base: { receipt, shift }, seed, media, serverTime: new Date().toISOString() }
  })

  app.post('/api/sync/push', { bodyLimit: 30_000_000 }, async (req) => {
    const tenantId = await deviceTenant(req)
    const body = pushBody.parse(req.body) as Record<string, Row[]>
    // Главный терминал вправе прислать данные только своего заведения.
    for (const [name] of SALES) if (body[name].some((r) => r.tenantId !== tenantId)) throw new HttpError(403, 'forbidden')

    const receiptIds = body.receipts.map((r) => String(r.id))
    return db.transaction(async (tx) => {
      const before = receiptIds.length
        ? await tx
            .select({ id: s.receipts.id, status: s.receipts.status })
            .from(s.receipts)
            .where(and(eq(s.receipts.tenantId, tenantId), inArray(s.receipts.id, receiptIds)))
        : []
      const prev = new Map(before.map((r) => [r.id, r.status]))

      // Остаток считает облако. Сначала возвращаем товар по чекам, которые были закрыты…
      for (const id of receiptIds) if (prev.get(id) === 'closed') await adjustStockForReceipt(tx, id, 1, true)

      for (const [name, table] of SALES) await upsert(tx, table, body[name])

      // Позиции и оплаты, которых в присланном чеке уже нет (удалили на кассе), убираем и в облаке.
      // Дальше работаем только с чеками, которые после записи действительно принадлежат заведению.
      const owned = receiptIds.length
        ? (await tx.select({ id: s.receipts.id }).from(s.receipts).where(and(eq(s.receipts.tenantId, tenantId), inArray(s.receipts.id, receiptIds)))).map((x) => x.id)
        : []
      if (owned.length !== receiptIds.length) throw new HttpError(403, 'forbidden')
      if (receiptIds.length) {
        const itemIds = body.receiptItems.map((r) => String(r.id))
        const payIds = body.payments.map((r) => String(r.id))
        await tx.delete(s.receiptItems).where(and(eq(s.receiptItems.tenantId, tenantId), inArray(s.receiptItems.receiptId, receiptIds), itemIds.length ? notInArray(s.receiptItems.id, itemIds) : undefined))
        await tx.delete(s.payments).where(and(eq(s.payments.tenantId, tenantId), inArray(s.payments.receiptId, receiptIds), payIds.length ? notInArray(s.payments.id, payIds) : undefined))
      }

      // …затем списываем по тем, что закрыты сейчас. Повторная отправка того же чека остаток не меняет.
      for (const r of body.receipts) if (r.status === 'closed') await adjustStockForReceipt(tx, String(r.id), -1, true)

      return { ok: true, receipts: receiptIds.length, serverTime: new Date().toISOString() }
    })
  })
}

// ───────────── Локальный сервер: фоновый обмен с облаком ─────────────

const localState: { online: boolean; lastSyncAt: string | null; error: string | null; pendingReceipts: number } = {
  online: false,
  lastSyncAt: null,
  error: null,
  pendingReceipts: 0,
}
/** Когда началась последняя удачная отправка и чьё это заведение. Хранятся и на диске. */
let lastPush: Date | null = null
let localTenant: string | null = null

const cloud = () => (process.env.CLOUD_URL ?? '').replace(/\/+$/, '')

async function cloudCall<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${cloud()}/api${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${process.env.SYNC_TOKEN ?? ''}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`cloud ${res.status}`)
  return (await res.json()) as T
}

type Pulled = { tenant: Row & { id: string }; pinKey: string; tables: Record<string, Row[]>; base: { receipt: number; shift: number }; seed: Record<string, Row[]>; media?: Row[] | null }
/** Логотип и фото забираем при первом обмене и затем раз в ~10 минут. */
let pulls = 0

/** Сохраняем ключ ПИН-кодов и базу нумерации на диск: после перезапуска без интернета они должны быть на месте. */
async function remember(db: DB, tenantId: string, key: string, base: { receipt: number; shift: number }, pushedAt: Date | null = lastPush) {
  setPinKey(tenantId, key)
  const cur = bases.get(tenantId)
  // База только растёт: облако может прислать меньше, если наши чеки ещё не дошли.
  const next = { receipt: Math.max(cur?.receipt ?? 0, base.receipt), shift: Math.max(cur?.shift ?? 0, base.shift) }
  bases.set(tenantId, next)
  const value = { tenantId, pinKey: key, base: next, lastPush: pushedAt ? pushedAt.toISOString() : null }
  await db
    .insert(s.platformSettings)
    .values({ key: `local:${tenantId}`, value })
    .onConflictDoUpdate({ target: s.platformSettings.key, set: { value } })
}

/** При запуске локального сервера поднимаем сохранённые ключ и базу нумерации. */
export async function restoreLocalState(db: DB) {
  const rows = await db.select().from(s.platformSettings)
  for (const r of rows) {
    if (!r.key.startsWith('local:')) continue
    const v = r.value as { tenantId: string; pinKey: string; base: { receipt: number; shift: number }; lastPush?: string | null }
    setPinKey(v.tenantId, v.pinKey)
    bases.set(v.tenantId, v.base)
    localTenant = v.tenantId
    lastPush = v.lastPush ? new Date(v.lastPush) : null
  }
}

/** Забрать настройки из облака и записать их в локальную базу. */
export async function pullFromCloud(db: DB) {
  const withMedia = pulls++ % 30 === 0
  const data = await cloudCall<Pulled>(withMedia ? '/sync/pull?media=1' : '/sync/pull')
  const tenantId = data.tenant.id
  await db.transaction(async (tx) => {
    await upsert(tx, s.tenants as unknown as AnyTable, [data.tenant])
    for (const [name, table] of CONFIG) await upsert(tx, table, data.tables[name] ?? [])
    // Открытую смену из облака берём только на пустой базе: дальше продажами владеет главный терминал.
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int`.mapWith(Number) }).from(s.shifts).where(eq(s.shifts.tenantId, tenantId))
    if (n === 0) for (const [name, table] of SALES) if (name !== 'auditLog') await upsert(tx, table, data.seed[name] ?? [])
    if (data.media) {
      await tx.delete(s.brandMedia).where(eq(s.brandMedia.tenantId, tenantId))
      await upsert(tx, s.brandMedia as unknown as AnyTable, data.media)
    }
  })
  // Что удалено в облаке, убираем и здесь. Если на строку ещё ссылаются чеки — оставляем (не страшно).
  for (const [name, table] of [...CONFIG].reverse()) {
    // Терминалы не трогаем: кассы, подключённые прямо к главному терминалу, известны только ему.
    if (name === 'terminals') continue
    const ids = (data.tables[name] ?? []).map((r) => String(r.id))
    if (!ids.length) continue
    try {
      await db.delete(table).where(and(eq(table.tenantId, tenantId), notInArray(table.id, ids)))
    } catch {
      /* строка занята — оставляем */
    }
  }
  await remember(db, tenantId, data.pinKey, data.base)
  return tenantId
}

/** Отправить в облако продажи: открытые смены и смены, закрытые недавно (или все — при первой отправке). */
export async function pushToCloud(db: DB, tenantId: string, since: Date | null) {
  const from = since ? new Date(since.getTime() - 15 * 60_000) : new Date(0)
  const shifts = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.tenantId, tenantId), or(isNull(s.shifts.closedAt), gte(s.shifts.closedAt, from))))
  if (!shifts.length) return 0
  const shiftIds = shifts.map((x) => x.id)
  const receipts = await db.select().from(s.receipts).where(inArray(s.receipts.shiftId, shiftIds))
  const rids = receipts.map((x) => x.id)
  const receiptItems = rids.length ? await db.select().from(s.receiptItems).where(inArray(s.receiptItems.receiptId, rids)) : []
  const payments = rids.length ? await db.select().from(s.payments).where(inArray(s.payments.receiptId, rids)) : []
  const cashMovements = await db.select().from(s.cashMovements).where(inArray(s.cashMovements.shiftId, shiftIds))
  const oldest = shifts.reduce((a, x) => (x.openedAt < a ? x.openedAt : a), shifts[0].openedAt)
  const auditLog = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), gte(s.auditLog.createdAt, oldest)))
  await cloudCall('/sync/push', { method: 'POST', body: { shifts, receipts, receiptItems, payments, cashMovements, auditLog } })
  return receipts.length
}

/** Один круг обмена. Ошибка связи — не авария: попробуем на следующем круге. */
export async function syncOnce(db: DB) {
  try {
    localTenant = await pullFromCloud(db)
    const started = new Date()
    await pushToCloud(db, localTenant, lastPush)
    lastPush = started
    await db
      .update(s.platformSettings)
      .set({ value: sql`${s.platformSettings.value} || ${JSON.stringify({ lastPush: started.toISOString() })}::jsonb` })
      .where(eq(s.platformSettings.key, `local:${localTenant}`))
    Object.assign(localState, { online: true, lastSyncAt: new Date().toISOString(), error: null })
  } catch (err) {
    Object.assign(localState, { online: false, error: err instanceof Error ? err.message : 'error' })
  }
  return localState
}

/** Запуск фонового обмена на локальном сервере. */
export async function startLocalSync(db: DB, log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (!isLocal()) return
  if (!cloud() || !process.env.SYNC_TOKEN) return log.warn('local: не заданы CLOUD_URL и SYNC_TOKEN — обмен с облаком выключен')
  await restoreLocalState(db)
  const every = Number(process.env.SYNC_SECONDS ?? 20) * 1000
  const loop = async () => {
    const st = await syncOnce(db)
    if (st.error) log.warn(`local: обмен отложен — ${st.error}`)
    setTimeout(loop, every).unref()
  }
  void loop()
  log.info('local: главный терминал, обмен с облаком запущен')
}
