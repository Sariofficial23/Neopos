import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { connect } from 'node:net'
import type { FastifyInstance } from 'fastify'

/**
 * Общий Telegram-бот NeoPos. Бот только открывает мини-приложение (кнопка «Открыть NeoPos»);
 * данные заведения показываются после входа логином и паролем от веб-панели.
 *
 * Настройка — две переменные окружения сервера:
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather;
 *   MINIAPP_URL        — адрес мини-приложения (по умолчанию панель NeoPos, раздел /tg).
 */
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const MINIAPP_URL = () => process.env.MINIAPP_URL?.trim() || 'https://neopos-panel.vercel.app/tg'
/** Секрет вебхука выводится из токена: Telegram присылает его в заголовке, чужие запросы отбрасываются. */
const secretOf = (token: string) => createHmac('sha256', token).update('neopos-telegram-webhook').digest('hex')

const TEXT = {
  uz: {
    hello: 'Assalomu alaykum! Bu — NeoPos.\n\nQuyidagi tugmani bosing va veb-paneldagi login va parolingiz bilan kiring: savdo, cheklar, xarajatlar va smenalar hisobotlari shu yerda.',
    open: '📊 NeoPos’ni ochish',
    menu: 'NeoPos',
    start: 'Hisobotlarni ochish',
  },
  ru: {
    hello: 'Здравствуйте! Это NeoPos.\n\nНажмите кнопку ниже и войдите логином и паролем от веб-панели: отчёты по продажам, чекам, расходам и сменам — здесь.',
    open: '📊 Открыть NeoPos',
    menu: 'NeoPos',
    start: 'Открыть отчёты',
  },
} as const

/**
 * Запрос к Telegram. Идёт строго по IPv4: у api.telegram.org есть IPv6-адрес,
 * а на хостинге (Render) исходящего IPv6 нет — обычный fetch зависает до таймаута.
 */
function call<T = unknown>(method: string, body: unknown): Promise<{ ok: boolean; description?: string; result?: T }> {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: 'api.telegram.org',
        path: `/bot${TOKEN()}/${method}`,
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

type Update = { message?: { chat: { id: number; type: string }; from?: { language_code?: string } } }

/** Что получилось при подключении бота — для страницы диагностики. Токена и секрета здесь нет. */
const state: { setup: string; lastSend: string | null } = { setup: 'not_started', lastSend: null }

export function telegramRoutes(app: FastifyInstance) {
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
      state.lastSend = 'replied_in_webhook'
      // Ответ отдаём прямо в ответе на запрос Telegram: серверу не нужно самому соединяться с Telegram.
      return {
        method: 'sendMessage',
        chat_id: msg.chat.id,
        text: L.hello,
        reply_markup: { inline_keyboard: [[{ text: L.open, web_app: { url: MINIAPP_URL() } }]] },
      }
    }
    // Telegram повторяет доставку, пока не получит 200 — отвечаем всегда.
    return { ok: true }
  })
}

/** При запуске сервера: подключает вебхук, кнопку меню и команду /start. Без токена ничего не делает. */
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
    await call('setMyCommands', { commands: [{ command: 'start', description: TEXT.uz.start }] })
    await call('setMyCommands', { language_code: 'ru', commands: [{ command: 'start', description: TEXT.ru.start }] })
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
