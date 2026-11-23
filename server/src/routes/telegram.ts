import { createHmac, timingSafeEqual } from 'node:crypto'
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

async function call(method: string, body: unknown): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  return (await res.json()) as { ok: boolean; description?: string }
}

type Update = { message?: { chat: { id: number; type: string }; from?: { language_code?: string } } }

export function telegramRoutes(app: FastifyInstance) {
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
      try {
        await call('sendMessage', {
          chat_id: msg.chat.id,
          text: L.hello,
          reply_markup: { inline_keyboard: [[{ text: L.open, web_app: { url: MINIAPP_URL() } }]] },
        })
      } catch (err) {
        req.log.warn({ err }, 'telegram: sendMessage failed')
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
  if (!base) return log.warn('telegram: адрес сервера неизвестен (PUBLIC_URL), вебхук не подключён')
  try {
    const hook = await call('setWebhook', { url: `${base}/api/telegram/webhook`, secret_token: secretOf(token), allowed_updates: ['message'] })
    if (!hook.ok) return log.warn(`telegram: вебхук не подключён — ${hook.description ?? 'ошибка'}`)
    await call('setChatMenuButton', { menu_button: { type: 'web_app', text: TEXT.ru.menu, web_app: { url: MINIAPP_URL() } } })
    await call('setMyCommands', { commands: [{ command: 'start', description: TEXT.uz.start }] })
    await call('setMyCommands', { language_code: 'ru', commands: [{ command: 'start', description: TEXT.ru.start }] })
    log.info('telegram: бот подключён')
  } catch {
    log.warn('telegram: не удалось связаться с Telegram')
  }
}
