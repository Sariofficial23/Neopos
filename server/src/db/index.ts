import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema.js'

export { schema }
export type DB = PgliteDatabase<typeof schema>

const here = dirname(fileURLToPath(import.meta.url))
// В приложении для Windows сервер собран в один файл, и папку миграций ему указывают явно.
const migrationsFolder = process.env.MIGRATIONS_DIR ?? resolve(here, '../../drizzle')

/**
 * Если задан DATABASE_URL — подключаемся к настоящему PostgreSQL (боевой режим).
 * Иначе используем встроенный PGlite с файлами в server/data — ничего ставить не нужно.
 */
export async function openDb(): Promise<DB> {
  const url = process.env.DATABASE_URL
  if (url) {
    const pg = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pool = new pg.default.Pool({
      connectionString: url,
      // Внешние адреса облачных баз требуют SSL; для внутренних он не нужен.
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    })
    const db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder })
    return db as unknown as DB
  }
  const dir = process.env.PGLITE_DIR ?? resolve(here, '../../data/pglite')
  if (dir !== 'memory://') mkdirSync(dir, { recursive: true })
  const client = new PGlite(dir)
  const db = drizzlePglite(client, { schema })
  await migratePglite(db, { migrationsFolder })
  return db
}
