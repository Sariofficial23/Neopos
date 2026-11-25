import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect } from 'node:net'
import { and, asc, eq, gte, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, makeAuthGuards } from '../auth.js'
import { schema, type DB } from '../db/index.js'
import { reportApi } from './reports.js'
import { dayStartOf } from './settings.js'

/**
 * Общий Telegram-бот NeoPos.
 *  • Кнопка «NeoPos» открывает мини-приложение с отчётами (вход логином и паролем от веб-панели).
 *  • В мини-приложении владелец включает уведомления — чат привязывается к заведению.
 *  • Бот сам присылает: сводку за вчерашний день, закрытие смены, подозрительные действия.
 *  • Команда /report — сводка за сегодня в любой момент.
 *
 * Настройка — переменные окружения сервера:
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather;
 *   MINIAPP_URL        — адрес мини-приложения (по умолчанию панель NeoPos, раздел /tg);
 *   TELEGRAM_API_URL, TELEGRAM_POLL_MS — только для проверки на компьютере разработчика.
 */
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const MINIAPP_URL = () => process.env.MINIAPP_URL?.trim() || 'https://neopos-panel.vercel.app/tg'
const API_URL = () => process.env.TELEGRAM_API_URL?.trim() || 'https://api.telegram.org'
/** Секрет вебхука выводится из токена: Telegram присылает его в заголовке, чужие запросы отбрасываются. */
const secretOf = (token: string) => createHmac('sha256', token).update('neopos-telegram-webhook').digest('hex')

type Lang = 'uz' | 'ru'
const TEXT = {
  uz: {
    hello: 'Assalomu alaykum! Bu — NeoPos.\n\nQuyidagi tugmani bosing va veb-paneldagi login va parolingiz bilan kiring: savdo, cheklar, xarajatlar va smenalar hisobotlari shu yerda.\n\nIlova ichida «Telegram xabarnomalari»ni yoqsangiz, bot har kuni xulosa, smena yopilishi va shubhali amallar haqida o‘zi yozadi.',
    open: '📊 NeoPos’ni ochish',
    menu: 'NeoPos',
    start: 'Hisobotlarni ochish',
    report: 'Bugungi xulosa',
    notLinked: 'Xulosa olish uchun avval pastdagi tugma orqali NeoPos’ni oching, kiring va «Telegram xabarnomalari»ni yoqing.',
    linked: (v: string) => `✅ «${v}» uchun xabarnomalar yoqildi.\n\nBot endi o‘zi yozadi: kechagi kun xulosasi, smena yopilishi va shubhali amallar. Bugungi xulosa — /report buyrug‘i.`,
    day: (d: string) => `📊 ${d} kuni xulosasi`,
    shiftClosed: (n: number) => `🔒 Smena №${n} yopildi`,
    revenue: 'Tushum',
    receipts: 'cheklar',
    expected: 'Dastur bo‘yicha naqd',
    counted: 'Kassada',
    diff: 'Farq',
    noDiff: 'Farq yo‘q ✓',
    employee: 'Xodim',
    receipt: 'Chek',
    table: 'stol',
    amount: 'Summa',
    sum: 'so‘m',
    more: (n: number) => `…va yana ${n} ta shubhali amal. To‘liq ro‘yxat — panelda «Hisobotlar → Shubhali».`,
    acts: {
      'receipt.close_unpaid': 'Chek to‘lovsiz yopildi',
      'receipt.refund': 'Chek qaytarildi',
      'receipt.reopen': 'Chek qayta ochildi',
      'receipt.discount': 'Chekka katta chegirma',
      'item.discount': 'Taomga katta chegirma',
      'item.void': 'Taom o‘chirildi',
      'item.comp': 'Mehmon qilindi',
      'item.price': 'Narx o‘zgartirildi',
      'receipt.unlock': 'Chek blokdan chiqarildi',
      'receipt.service': 'Xizmat haqi kamaytirildi',
      'receipt.move': 'Chek boshqa stolga ko‘chirildi',
    } as Record<string, string>,
    act: 'Shubhali amal',
  },
  ru: {
    hello: 'Здравствуйте! Это NeoPos.\n\nНажмите кнопку ниже и войдите логином и паролем от веб-панели: отчёты по продажам, чекам, расходам и сменам — здесь.\n\nВключите в приложении «Уведомления в Telegram» — и бот сам будет присылать сводку за день, закрытие смены и подозрительные действия.',
    open: '📊 Открыть NeoPos',
    menu: 'NeoPos',
    start: 'Открыть отчёты',
    report: 'Сводка за сегодня',
    notLinked: 'Чтобы получать сводку, сначала откройте NeoPos кнопкой ниже, войдите и включите «Уведомления в Telegram».',
    linked: (v: string) => `✅ Уведомления для «${v}» включены.\n\nТеперь бот сам пришлёт: сводку за вчерашний день, закрытие смены и подозрительные действия. Сводка за сегодня — команда /report.`,
    day: (d: string) => `📊 Сводка за ${d}`,
    shiftClosed: (n: number) => `🔒 Смена №${n} закрыта`,
    revenue: 'Выручка',
    receipts: 'чеков',
    expected: 'Наличные по программе',
    counted: 'В кассе',
    diff: 'Расхождение',
    noDiff: 'Расхождения нет ✓',
    employee: 'Сотрудник',
    receipt: 'Чек',
    table: 'стол',
    amount: 'Сумма',
    sum: 'сум',
    more: (n: number) => `…и ещё подозрительных действий: ${n}. Полный список — в панели, «Отчёты → Подозрительные».`,
    acts: {
      'receipt.close_unpaid': 'Чек закрыт без оплаты',
      'receipt.refund': 'Возврат чека',
      'receipt.reopen': 'Чек открыт повторно',
      'receipt.discount': 'Большая скидка на чек',
      'item.discount': 'Большая скидка на позицию',
      'item.void': 'Удалена позиция',
      'item.comp': 'Угощение',
      'item.price': 'Изменена цена',
      'receipt.unlock': 'Снята блокировка чека',
      'receipt.service': 'Снижен процент обслуживания',
      'receipt.move': 'Чек перенесён на другой стол',
    } as Record<string, string>,
    act: 'Подозрительное действие',
  },
} as const

/**
 * Запрос к Telegram. Идёт строго по IPv4: у api.telegram.org есть IPv6-адрес,
 * а на хостинге (Render) исходящего IPv6 нет — обычный fetch зависает до таймаута.
 */
function call<T = unknown>(method: string, body: unknown): Promise<{ ok: boolean; error_code?: number; description?: string; result?: T }> {
  const data = JSON.stringify(body)
  const url = new URL(`${API_URL()}/bot${TOKEN()}/${method}`)
  const request = url.protocol === 'http:' ? httpRequest : httpsRequest
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        port: url.port || undefined,
        path: url.pathname,
        method: 'POST',
        family: 4,
        timeout: 10_000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new Error('bad_response'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(data)
  })
}

/** Проверка сети с сервера: DNS, соединение с адресами Telegram и с посторонним сайтом. */
async function probe() {
  const tcp = (host: string) =>
    new Promise<string>((resolve) => {
      const started = Date.now()
      const sock = connect({ host, port: 443, family: 4, timeout: 6000 })
      sock.on('connect', () => (sock.destroy(), resolve(`ok ${Date.now() - started}ms`)))
      sock.on('timeout', () => (sock.destroy(), resolve('timeout')))
      sock.on('error', (e) => resolve(`error ${(e as NodeJS.ErrnoException).code ?? e.message}`))
    })
  const dns = await lookup('api.telegram.org', { all: true }).catch((e) => `dns error ${e.code}`)
  const v4 = Array.isArray(dns) ? dns.filter((d) => d.family === 4).map((d) => d.address) : []
  const hosts = [...new Set([...v4, '149.154.167.220', '149.154.166.110', 'example.com'])]
  const results = await Promise.all(hosts.map(async (h) => [h, await tcp(h)] as const))
  return { dns, tcp: Object.fromEntries(results) }
}

type Update = { message?: { chat: { id: number; type: string }; text?: string; from?: { language_code?: string } } }

/** Что получилось при подключении бота — для страницы диагностики. Токена и секрета здесь нет. */
const state: { setup: string; lastSend: string | null; notifier: string } = { setup: 'not_started', lastSend: null, notifier: 'off' }

const { telegramLinks, auditLog, tenants, users, receipts, tables, shifts } = schema
const NOTIFY = ['digest', 'shift', 'suspicious'] as const
type Notify = Record<(typeof NOTIFY)[number], boolean>
const notifyOf = (v: Record<string, boolean> | null | undefined): Notify => ({ digest: v?.digest !== false, shift: v?.shift !== false, suspicious: v?.suspicious !== false })

const money = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/[  ]/g, ' ')
const TASHKENT = 5 * 3600_000
/** Дата рабочего дня заведения (ГГГГ-ММ-ДД) со сдвигом на days дней: день начинается в час h по Ташкенту. */
const businessDay = (h: number, days = 0) => new Date(Date.now() + TASHKENT - h * 3600_000 + days * 86_400_000).toISOString().slice(0, 10)
const niceDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

/**
 * Проверка данных, которые Telegram передаёт мини-приложению: подпись считается от токена бота,
 * подделать её без токена нельзя. Возвращает номер чата (он же номер пользователя) или null.
 */
function chatFromInitData(initData: string): string | null {
  const token = TOKEN()
  if (!token) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash') ?? ''
  params.delete('hash')
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const want = Buffer.from(createHmac('sha256', secret).update(check).digest('hex'))
  const got = Buffer.from(hash)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  // Данные действуют сутки: старую перехваченную строку использовать нельзя.
  if (Math.abs(Date.now() / 1000 - Number(params.get('auth_date') ?? 0)) > 86_400) return null
  try {
    const id = (JSON.parse(params.get('user') ?? '{}') as { id?: number }).id
    return typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : null
  } catch {
    return null
  }
}

export function telegramRoutes(app: FastifyInstance, db: DB) {
  const { requirePerm } = makeAuthGuards(db)

  // Диагностика подключения: имя бота, адрес вебхука и последняя ошибка доставки по данным Telegram.
  app.get('/api/telegram/status', async () => {
    if (!TOKEN()) return { configured: false }
    try {
      const me = await call<{ username: string }>('getMe', {})
      if (!me.ok) return { configured: true, tokenValid: false, error: me.description, setup: state.setup }
      const hook = await call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>('getWebhookInfo', {})
      return {
        configured: true,
        tokenValid: true,
        bot: me.result?.username,
        setup: state.setup,
        notifier: state.notifier,
        webhookUrl: hook.result?.url ?? '',
        pending: hook.result?.pending_update_count ?? 0,
        lastError: hook.result?.last_error_message ?? null,
        lastErrorAt: hook.result?.last_error_date ? new Date(hook.result.last_error_date * 1000).toISOString() : null,
        lastSend: state.lastSend,
        publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '') || null,
      }
    } catch {
      return { configured: true, error: 'telegram_unreachable', setup: state.setup, lastSend: state.lastSend, net: await probe() }
    }
  })

  // ───── Привязка чата к заведению (из мини-приложения, после входа) ─────

  const linkBody = z.object({ initData: z.string().min(1).max(8192) })
  const chatOf = (initData: string) => {
    if (!TOKEN()) throw new HttpError(503, 'telegram_off')
    const chatId = chatFromInitData(initData)
    if (!chatId) throw new HttpError(400, 'telegram_bad_data')
    return chatId
  }
  const linkOf = async (tenantId: string, chatId: string) =>
    (await db.select().from(telegramLinks).where(and(eq(telegramLinks.tenantId, tenantId), eq(telegramLinks.chatId, chatId))))[0]

  /** Включены ли уведомления для этого чата и этого заведения. */
  app.post('/api/telegram/link/state', { preHandler: requirePerm('reports.view') }, async (req) => {
    const { initData } = linkBody.parse(req.body)
    const link = await linkOf(req.auth.tenantId, chatOf(initData))
    return { linked: !!link, notify: notifyOf(link?.notify) }
  })

  /** Включить уведомления или поменять их набор. При первом включении бот присылает подтверждение. */
  app.post('/api/telegram/link', { preHandler: requirePerm('reports.view') }, async (req) => {
    const body = linkBody
      .extend({ lang: z.enum(['uz', 'ru']).default('uz'), notify: z.object({ digest: z.boolean(), shift: z.boolean(), suspicious: z.boolean() }).partial().default({}) })
      .parse(req.body)
    const tenantId = req.auth.tenantId
    const chatId = chatOf(body.initData)
    const old = await linkOf(tenantId, chatId)
    const notify = { ...notifyOf(old?.notify), ...body.notify }
    if (old) await db.update(telegramLinks).set({ notify, lang: body.lang, userId: req.auth.userId }).where(eq(telegramLinks.id, old.id))
    else await db.insert(telegramLinks).values({ tenantId, userId: req.auth.userId, chatId, lang: body.lang, notify })
    let sent = true
    if (!old) {
      const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
      sent = await call('sendMessage', { chat_id: chatId, text: TEXT[body.lang].linked(t?.name ?? 'NeoPos') })
        .then((r) => r.ok)
        .catch(() => false)
    }
    return { linked: true, notify, sent }
  })

  /** Выключить уведомления для этого чата. */
  app.post('/api/telegram/unlink', { preHandler: requirePerm('reports.view') }, async (req) => {
    const { initData } = linkBody.parse(req.body)
    await db.delete(telegramLinks).where(and(eq(telegramLinks.tenantId, req.auth.tenantId), eq(telegramLinks.chatId, chatOf(initData))))
    return { linked: false, notify: notifyOf(null) }
  })

  app.post('/api/telegram/webhook', async (req, reply) => {
    const token = TOKEN()
    if (!token) return reply.code(404).send({ error: 'not_found' })
    const got = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] ?? ''))
    const want = Buffer.from(secretOf(token))
    if (got.length !== want.length || !timingSafeEqual(got, want)) return reply.code(401).send({ error: 'unauthorized' })

    const msg = (req.body as Update | undefined)?.message
    // Отвечаем только в личных чатах: в группе кнопка мини-приложения не работает.
    if (msg && msg.chat.type === 'private') {
      const L = TEXT[msg.from?.language_code?.startsWith('ru') ? 'ru' : 'uz']
      const button = { inline_keyboard: [[{ text: L.open, web_app: { url: MINIAPP_URL() } }]] }
      state.lastSend = 'replied_in_webhook'
      // Ответ отдаём прямо в ответе на запрос Telegram: серверу не нужно самому соединяться с Telegram.
      if (/^\/report\b/.test(msg.text ?? '')) {
        const links = await db
          .select({ tenantId: telegramLinks.tenantId, lang: telegramLinks.lang, settings: tenants.settings })
          .from(telegramLinks)
          .innerJoin(tenants, eq(tenants.id, telegramLinks.tenantId))
          .where(eq(telegramLinks.chatId, String(msg.chat.id)))
          .limit(3)
        if (!links.length || !reportApi.digest) return { method: 'sendMessage', chat_id: msg.chat.id, text: L.notLinked, reply_markup: button }
        const parts: string[] = []
        for (const l of links) {
          const lang: Lang = l.lang === 'ru' ? 'ru' : 'uz'
          const d = businessDay(dayStartOf(l.settings))
          parts.push(`${TEXT[lang].day(niceDay(d))}\n\n${(await reportApi.digest(l.tenantId, d, d, lang)).text}`)
        }
        return { method: 'sendMessage', chat_id: msg.chat.id, text: parts.join('\n\n———\n\n').slice(0, 4000) }
      }
      return { method: 'sendMessage', chat_id: msg.chat.id, text: L.hello, reply_markup: button }
    }
    // Telegram повторяет доставку, пока не получит 200 — отвечаем всегда.
    return { ok: true }
  })
}

/** При запуске сервера: подключает вебхук, кнопку меню и команды. Без токена ничего не делает. */
export async function setupTelegramBot(log: { info: (m: string) => void; warn: (m: string) => void }) {
  const token = TOKEN()
  if (!token) return
  const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')
  if (!base) {
    state.setup = 'no_public_url'
    return log.warn('telegram: адрес сервера неизвестен (PUBLIC_URL), вебхук не подключён')
  }
  try {
    const hook = await call('setWebhook', { url: `${base}/api/telegram/webhook`, secret_token: secretOf(token), allowed_updates: ['message'] })
    if (!hook.ok) {
      state.setup = `webhook_failed: ${hook.description ?? 'error'}`
      return log.warn(`telegram: вебхук не подключён — ${hook.description ?? 'ошибка'}`)
    }
    await call('setChatMenuButton', { menu_button: { type: 'web_app', text: TEXT.ru.menu, web_app: { url: MINIAPP_URL() } } })
    for (const lang of ['uz', 'ru'] as const)
      await call('setMyCommands', {
        ...(lang === 'ru' ? { language_code: 'ru' } : {}),
        commands: [
          { command: 'start', description: TEXT[lang].start },
          { command: 'report', description: TEXT[lang].report },
        ],
      })
    state.setup = 'ok'
    log.info('telegram: бот подключён')
  } catch (err) {
    state.setup = `unreachable: ${err instanceof Error ? err.message : 'error'}`
    log.warn('telegram: не удалось связаться с Telegram')
  }
}

/**
 * Данные для привязки бота из админ-панели. С хостинга Telegram недоступен, поэтому вебхук
 * один раз подключает браузер администратора: ему нужны адрес вебхука и секрет.
 */
export function telegramSetupInfo() {
  const token = TOKEN()
  const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')
  if (!token || !base) return { configured: false as const }
  return { configured: true as const, webhookUrl: `${base}/api/telegram/webhook`, secret: secretOf(token), miniappUrl: MINIAPP_URL() }
}

/**
 * Подключение бота с повторами: связь хостинга с Telegram нестабильна, поэтому при неудаче
 * пробуем снова раз в 2 минуты (до 15 раз) — редко, чтобы не упереться в ограничение запросов.
 */
export async function startTelegramBot(log: { info: (m: string) => void; warn: (m: string) => void }) {
  for (let attempt = 0; attempt < 15; attempt++) {
    await setupTelegramBot(log)
    if (state.setup === 'ok' || !TOKEN()) return
    await new Promise((r) => setTimeout(r, 2 * 60_000).unref())
  }
}

// ───────────── Рассылка: сводка за день, закрытие смены, подозрительные действия ─────────────

type Link = typeof telegramLinks.$inferSelect
/** Сообщение не ушло из-за связи с Telegram: запись остаётся неотмеченной, попробуем позже. */
class SendError extends Error {}

/**
 * Раз в полминуты сервер смотрит журнал действий и рассылает то, о чём ещё не сообщал.
 * Отметка «сообщено» хранится в самой записи журнала, поэтому повторов нет ни после перезапуска,
 * ни когда главный терминал заведения присылает продажи с опозданием.
 */
export function startTelegramNotifier(db: DB, log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (!TOKEN() || process.env.NEOPOS_LOCAL === '1') return
  const every = Math.max(1000, Number(process.env.TELEGRAM_POLL_MS) || 30_000)
  let busy = false
  state.notifier = 'on'

  /** Отправка одному получателю. Если он остановил бота — отвязываем чат, чтобы не слать впустую. */
  async function send(link: Link, text: string) {
    const res = await call('sendMessage', { chat_id: link.chatId, text: text.slice(0, 4000) }).catch((err) => {
      throw new SendError(err instanceof Error ? err.message : 'unreachable')
    })
    if (!res.ok && res.error_code === 403) await db.delete(telegramLinks).where(eq(telegramLinks.id, link.id))
    else if (!res.ok) throw new SendError(res.description ?? 'send_failed')
    state.lastSend = new Date().toISOString()
  }

  async function tick() {
    const links = await db.select().from(telegramLinks).where(isNotNull(telegramLinks.chatId))
    const byTenant = new Map<string, Link[]>()
    for (const l of links) byTenant.set(l.tenantId, [...(byTenant.get(l.tenantId) ?? []), l])

    for (const [tenantId, mine] of byTenant) {
      const [tenant] = await db.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId))
      if (!tenant) continue
      const langOf = (l: Link): Lang => (l.lang === 'ru' ? 'ru' : 'uz')

      // ── Закрытие смены и подозрительные действия ──
      const rows = await db
        .select({ a: auditLog, userName: users.name, number: receipts.number, tableName: tables.name })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .leftJoin(receipts, eq(receipts.id, auditLog.receiptId))
        .leftJoin(tables, eq(tables.id, receipts.tableId))
        .where(
          and(
            eq(auditLog.tenantId, tenantId),
            isNull(auditLog.notifiedAt),
            gte(auditLog.createdAt, new Date(Date.now() - 86_400_000)),
            or(eq(auditLog.suspicious, true), eq(auditLog.action, 'shift.close')),
          ),
        )
        .orderBy(asc(auditLog.createdAt))
        .limit(200)
      let alerts = 0
      for (const { a, userName, number, tableName } of rows) {
        const d = a.data as Record<string, unknown>
        const n = (v: unknown) => (typeof v === 'number' ? v : 0)
        const isShift = a.action === 'shift.close'
        // Получает тот, кто включил уведомления раньше, чем это случилось: старое не присылаем.
        const to = mine.filter((l) => l.createdAt <= a.createdAt && notifyOf(l.notify)[isShift ? 'shift' : 'suspicious'])
        // За один проход — не больше 15 сообщений о действиях, об остальных скажем одной строкой.
        const quiet = !isShift && ++alerts > 15
        // Ошибка в одной записи не должна останавливать остальные: её пропускаем, сбой связи — повторяем позже.
        if (to.length && !quiet) try {
          let sales = { revenue: 0, count: 0 }
          if (isShift) {
            const [s] = await db
              .select({ revenue: sql<number>`coalesce(sum(${receipts.total}), 0)::float8`, count: sql<number>`count(*)::int` })
              .from(receipts)
              .innerJoin(shifts, eq(shifts.id, receipts.shiftId))
              .where(and(eq(receipts.tenantId, tenantId), eq(shifts.number, n(d.number)), eq(receipts.status, 'closed')))
            if (s) sales = s
          }
          for (const l of to) {
            const L = TEXT[langOf(l)]
            const lines: string[] = []
            if (isShift) {
              const diff = n(d.countedCash) - n(d.expectedCash)
              lines.push(L.shiftClosed(n(d.number)), tenant.name, '')
              lines.push(`${L.revenue}: ${money(sales.revenue)} ${L.sum} (${L.receipts}: ${sales.count})`)
              lines.push(`${L.expected}: ${money(n(d.expectedCash))} ${L.sum}`, `${L.counted}: ${money(n(d.countedCash))} ${L.sum}`)
              lines.push(diff === 0 ? L.noDiff : `⚠️ ${L.diff}: ${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} ${L.sum}`)
            } else {
              const name = d.name && typeof d.name === 'object' ? String((d.name as Record<string, unknown>)[langOf(l)] ?? '') : ''
              const amount = n(d.total) || n(d.amount)
              lines.push(`⚠️ ${L.acts[a.action] ?? L.act}`, tenant.name, '')
              if (number != null) lines.push(`${L.receipt} №${number}${tableName ? ` · ${L.table} ${tableName}` : ''}`)
              if (name) lines.push(name)
              if (d.kind === 'percent' && n(d.value)) lines.push(`${n(d.value)}%`)
              if (a.action === 'receipt.service' || a.action === 'item.price') lines.push(`${String(d.from)} → ${String(d.to)}`)
              if (amount) lines.push(`${L.amount}: ${money(amount)} ${L.sum}`)
            }
            if (userName) lines.push(`${L.employee}: ${userName}`)
            await send(l, lines.join('\n'))
          }
        } catch (err) {
          if (err instanceof SendError) throw err
          log.warn(`telegram: запись журнала ${a.id} пропущена — ${err instanceof Error ? err.message : 'ошибка'}`)
        }
        await db.update(auditLog).set({ notifiedAt: new Date() }).where(eq(auditLog.id, a.id))
      }
      if (alerts > 15) for (const l of mine.filter((x) => notifyOf(x.notify).suspicious)) await send(l, `${TEXT[langOf(l)].more(alerts - 15)}\n${tenant.name}`)

      // ── Сводка за вчерашний рабочий день: утром, один раз ──
      const h = dayStartOf(tenant.settings)
      const target = businessDay(h, -1)
      const hourNow = new Date(Date.now() + TASHKENT).getUTCHours()
      if (reportApi.digest && hourNow >= Math.max(h, 9)) {
        for (const l of mine) {
          if (l.digestSentOn === target || !notifyOf(l.notify).digest) continue
          const lang = langOf(l)
          const d = await reportApi.digest(tenantId, target, target, lang)
          // День без продаж — не беспокоим.
          if (d.receipts > 0) await send(l, `${TEXT[lang].day(niceDay(target))}\n${tenant.name}\n\n${d.text}`)
          await db.update(telegramLinks).set({ digestSentOn: target }).where(eq(telegramLinks.id, l.id))
        }
      }
    }
  }

  setInterval(() => {
    if (busy) return
    busy = true
    tick()
      .then(() => (state.notifier = 'on'))
      .catch((err) => {
        // Сбой связи: отметки «сообщено» не ставились, попробуем в следующий раз.
        state.notifier = `error: ${err instanceof Error ? err.message : 'error'}`
        log.warn(`telegram: рассылка не прошла — ${err instanceof Error ? err.message : 'ошибка'}`)
      })
      .finally(() => (busy = false))
  }, every).unref()
  log.info('telegram: рассылка уведомлений включена')
}
