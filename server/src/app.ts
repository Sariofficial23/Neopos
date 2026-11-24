import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { getSecret, HttpError } from './auth.js'
import type { DB } from './db/index.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { brandRoutes } from './routes/brand.js'
import { supplyRoutes } from './routes/supplies.js'
import { syncRoutes } from './routes/sync.js'
import { terminalRoutes } from './routes/terminals.js'
import { subscriptionRoutes } from './routes/subscription.js'
import { telegramRoutes } from './routes/telegram.js'
import { paymentMethodRoutes } from './routes/payment-methods.js'
import { financeRoutes } from './routes/finance.js'
import { hallRoutes, menuRoutes } from './routes/menu.js'
import { posRoutes } from './routes/pos.js'
import { reportRoutes } from './routes/reports.js'
import { settingsRoutes } from './routes/settings.js'
import { staffRoutes } from './routes/staff.js'

export async function buildApp(db: DB) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })
  // Панель и касса живут на других доменах (Vercel), поэтому изменения и удаления
  // нужно разрешить явно: по умолчанию @fastify/cors пропускает только GET, HEAD и POST.
  // Вход по токену в заголовке, а не по cookie, поэтому разрешать любой домен безопасно.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
  })
  await app.register(jwt, { secret: getSecret() })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code })
    }
    if (err instanceof ZodError) {
      return reply
        .status(400)
        .send({ error: 'validation', fields: err.issues.map((i) => i.path.join('.')) })
    }
    // Ошибки самого Fastify (плохой JSON, слишком большое тело) — это ошибки клиента, не сервера.
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'bad_request' })
    }
    app.log.error(err)
    return reply.status(500).send({ error: 'internal' })
  })

  // commit — какая версия кода запущена (Render передаёт его сам); помогает понять, обновился ли сервер.
  app.get('/api/health', async () => ({ ok: true, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null }))
  authRoutes(app, db)
  staffRoutes(app, db)
  menuRoutes(app, db)
  hallRoutes(app, db)
  posRoutes(app, db)
  settingsRoutes(app, db)
  reportRoutes(app, db)
  adminRoutes(app, db)
  financeRoutes(app, db)
  brandRoutes(app, db)
  supplyRoutes(app, db)
  syncRoutes(app, db)
  terminalRoutes(app, db)
  subscriptionRoutes(app, db)
  telegramRoutes(app)
  paymentMethodRoutes(app, db)
  serveKassa(app)
  return app
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
}

/**
 * Главный терминал сам отдаёт экран кассы (папка KASSA_DIR): без интернета сайт кассы недоступен,
 * а остальные кассы заведения открывают её по локальной сети с этого же адреса.
 */
function serveKassa(app: FastifyInstance) {
  const root = process.env.KASSA_DIR ? resolve(process.env.KASSA_DIR) : ''
  if (!root || !existsSync(join(root, 'index.html'))) return
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]
    if (req.method !== 'GET' || path.startsWith('/api/')) return reply.status(404).send({ error: 'not_found' })
    let file = normalize(join(root, decodeURIComponent(path)))
    // Наружу из папки кассы не выходим; неизвестный адрес — это страница кассы.
    if (!(file + sep).startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html')
    const ext = extname(file).toLowerCase()
    return reply
      .header('Content-Type', MIME[ext] ?? 'application/octet-stream')
      // Файлы с отпечатком в имени не меняются; саму страницу всегда берём свежую.
      .header('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
      .send(readFileSync(file))
  })
}
