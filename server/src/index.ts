import { buildApp } from './app.js'
import { openDb } from './db/index.js'
import { ensurePlatformAdmin } from './routes/admin.js'
import { startLocalSync } from './routes/sync.js'
import { startTelegramBot } from './routes/telegram.js'

const db = await openDb()
const app = await buildApp(db)
await ensurePlatformAdmin(db, (msg) => app.log.warn(msg))
const port = Number(process.env.PORT ?? 4000)
// На хостинге (Render и т. п.) сервер должен слушать все адреса; локально — только свой компьютер.
const hosted = process.env.NODE_ENV === 'production' || !!process.env.RENDER
await app.listen({ port, host: process.env.HOST ?? (hosted ? '0.0.0.0' : '127.0.0.1') })
// Telegram-бот подключается после старта: его сбой не должен мешать работе кассы.
void startTelegramBot({ info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) })

// Бесплатный сервер Render засыпает после 15 минут без запросов, и бот отвечает с задержкой.
// Раз в 10 минут сервер обращается к себе по внешнему адресу — этого достаточно, чтобы не засыпать.
const selfUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')
if (selfUrl) {
  setInterval(() => {
    fetch(`${selfUrl}/api/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => {
      /* следующий раз через 10 минут */
    })
  }, 10 * 60_000).unref()
}

// Главный терминал заведения: фоновый обмен с облаком (docs/LOCAL-NETWORK.md).
void startLocalSync(db, { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) })
