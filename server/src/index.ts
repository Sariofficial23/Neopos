import { buildApp } from './app.js'
import { openDb } from './db/index.js'
import { ensurePlatformAdmin } from './routes/admin.js'
import { setupTelegramBot } from './routes/telegram.js'

const db = await openDb()
const app = await buildApp(db)
await ensurePlatformAdmin(db, (msg) => app.log.warn(msg))
const port = Number(process.env.PORT ?? 4000)
// На хостинге (Render и т. п.) сервер должен слушать все адреса; локально — только свой компьютер.
const hosted = process.env.NODE_ENV === 'production' || !!process.env.RENDER
await app.listen({ port, host: process.env.HOST ?? (hosted ? '0.0.0.0' : '127.0.0.1') })
// Telegram-бот подключается после старта: его сбой не должен мешать работе кассы.
void setupTelegramBot({ info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) })
