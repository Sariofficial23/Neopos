import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { getSecret, HttpError } from './auth.js'
import type { DB } from './db/index.js'
import { authRoutes } from './routes/auth.js'
import { hallRoutes, menuRoutes } from './routes/menu.js'
import { posRoutes } from './routes/pos.js'
import { reportRoutes } from './routes/reports.js'
import { settingsRoutes } from './routes/settings.js'
import { staffRoutes } from './routes/staff.js'

export async function buildApp(db: DB) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })
  await app.register(cors, { origin: true })
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

  app.get('/api/health', async () => ({ ok: true }))
  authRoutes(app, db)
  staffRoutes(app, db)
  menuRoutes(app, db)
  hallRoutes(app, db)
  posRoutes(app, db)
  settingsRoutes(app, db)
  reportRoutes(app, db)
  return app
}
