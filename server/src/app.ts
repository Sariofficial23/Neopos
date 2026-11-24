import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { getSecret, HttpError } from './auth.js'
import type { DB } from './db/index.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { brandRoutes } from './routes/brand.js'
import { supplyRoutes } from './routes/supplies.js'
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
  terminalRoutes(app, db)
  subscriptionRoutes(app, db)
  telegramRoutes(app)
  paymentMethodRoutes(app, db)
  return app
}
