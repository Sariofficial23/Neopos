import { useEffect, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { adminApi } from './Admin'

/**
 * Привязка Telegram-бота. Сервер на хостинге не может сам соединиться с Telegram,
 * поэтому настройку делает браузер администратора: токен уходит только в Telegram и нигде не сохраняется.
 */

type Setup = { configured: false } | { configured: true; webhookUrl: string; secret: string; miniappUrl: string }

const W = {
  title: { uz: 'Telegram-bot', ru: 'Telegram-бот' },
  hint: {
    uz: 'Botni serverga bir marta ulash kerak. @BotFather bergan tokenni kiriting — u faqat Telegram’ga yuboriladi va saqlanmaydi.',
    ru: 'Бота нужно один раз привязать к серверу. Вставьте токен от @BotFather — он уходит только в Telegram и нигде не сохраняется.',
  },
  noServer: {
    uz: 'Avval serverda (Render → Environment) TELEGRAM_BOT_TOKEN o‘zgaruvchisini qo‘shing.',
    ru: 'Сначала добавьте на сервере (Render → Environment) переменную TELEGRAM_BOT_TOKEN.',
  },
  token: { uz: 'Bot tokeni', ru: 'Токен бота' },
  connect: { uz: 'Botni ulash', ru: 'Подключить бота' },
  working: { uz: 'Ulanmoqda…', ru: 'Подключаю…' },
  done: { uz: 'ulandi. Botni oching va «Start» bosing.', ru: 'подключён. Откройте бота и нажмите «Старт».' },
  badToken: { uz: 'Token noto‘g‘ri — @BotFather’dan qayta nusxalang', ru: 'Токен неверный — скопируйте его заново из @BotFather' },
  badFormat: {
    uz: 'Bu tokenga o‘xshamaydi. Token ko‘rinishi: 1234567890:AAH… (bo‘sh joysiz, ortiqcha so‘zlarsiz).',
    ru: 'Это не похоже на токен. Токен выглядит так: 1234567890:AAH… (без пробелов и лишних слов).',
  },
  notTelegram: {
    uz: 'Javob Telegram’dan kelmadi: provayder yoki brauzer kengaytmasi to‘sayotgan bo‘lishi mumkin. VPN yoki boshqa brauzerda urinib ko‘ring',
    ru: 'Ответ пришёл не от Telegram: возможно, мешает провайдер или расширение браузера. Попробуйте с VPN или в другом браузере',
  },
  noNet: { uz: 'Telegram’ga ulanib bo‘lmadi. Internetni tekshiring.', ru: 'Не удалось связаться с Telegram. Проверьте интернет.' },
  open: { uz: 'Botni ochish', ru: 'Открыть бота' },
} as const

/** Ошибка Telegram с кодом ответа: по нему видно, неверен токен или мешает что-то ещё. */
class TgError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Запрос к Telegram из браузера: «простая» форма, чтобы не было предварительной проверки CORS. */
async function tgCall<T>(token: string, method: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: new URLSearchParams(params) })
  let data: { ok: boolean; result?: T; description?: string }
  try {
    data = await res.json()
  } catch {
    // Ответ пришёл не от Telegram (например, страница блокировки провайдера или расширения браузера).
    throw new TgError(res.status, 'not_telegram')
  }
  if (!data.ok) throw new TgError(res.status, data.description ?? 'error')
  return data.result as T
}

export function TelegramCard() {
  const { lang } = useI18n()
  const [setup, setSetup] = useState<Setup | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [bot, setBot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminApi<Setup>('/admin/telegram')
      .then(setSetup)
      .catch(() => setSetup(null))
  }, [])

  async function connect(e: FormEvent) {
    e.preventDefault()
    if (!setup?.configured) return
    const tk = token.trim()
    setBusy(true)
    setError(null)
    setBot(null)
    try {
      // В токене не должно быть пробелов и лишних слов: только «цифры:буквы».
      if (!/^d{6,}:[w-]{30,}$/.test(tk)) throw new Error(W.badFormat[lang])
      const me = await tgCall<{ username: string }>(tk, 'getMe')
      await tgCall(tk, 'setWebhook', { url: setup.webhookUrl, secret_token: setup.secret, allowed_updates: JSON.stringify(['message']) })
      await tgCall(tk, 'setChatMenuButton', { menu_button: JSON.stringify({ type: 'web_app', text: 'NeoPos', web_app: { url: setup.miniappUrl } }) })
      await tgCall(tk, 'setMyCommands', { commands: JSON.stringify([{ command: 'start', description: 'Hisobotlarni ochish' }]) })
      await tgCall(tk, 'setMyCommands', { language_code: 'ru', commands: JSON.stringify([{ command: 'start', description: 'Открыть отчёты' }]) })
      setBot(me.username)
      setToken('')
    } catch (err) {
      setError(
        err instanceof TgError
          ? err.message === 'not_telegram'
            ? `${W.notTelegram[lang]} (HTTP ${err.status})`
            : err.status === 401 || err.status === 404
              ? `${W.badToken[lang]} (Telegram: ${err.status} ${err.message})`
              : `Telegram: ${err.status} ${err.message}`
          : err instanceof TypeError
            ? W.noNet[lang]
            : err instanceof Error
              ? err.message
              : W.noNet[lang],
      )
    } finally {
      setBusy(false)
    }
  }

  if (!setup) return null
  return (
    <section className="card space-y-3 p-4">
      <div>
        <div className="font-medium">{W.title[lang]}</div>
        <div className="text-sm text-slate-500">{setup.configured ? W.hint[lang] : W.noServer[lang]}</div>
      </div>
      {setup.configured && (
        <form onSubmit={connect} className="flex flex-wrap gap-2">
          <input
            className="input min-w-56 flex-1"
            type="password"
            required
            autoComplete="off"
            placeholder="1234567890:AA…"
            aria-label={W.token[lang]}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || !token.trim()}>
            {busy ? W.working[lang] : W.connect[lang]}
          </button>
        </form>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      {bot && (
        <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          ✓ @{bot} {W.done[lang]}{' '}
          <a className="underline" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">
            {W.open[lang]}
          </a>
        </div>
      )}
    </section>
  )
}
