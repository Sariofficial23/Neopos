/**
 * Создаёт демо-заведение для разработки. Логин и пароль берутся из переменных
 * SEED_LOGIN / SEED_PASSWORD; если пароль не задан — генерируется и пишется
 * в server/data/demo-credentials.txt (папка data не попадает в git).
 */
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { openDb, schema } from './db/index.js'
import { createTenant } from './tenant.js'

const db = await openDb()
const login = process.env.SEED_LOGIN ?? 'demo'
const [existing] = await db.select().from(schema.users).where(eq(schema.users.login, login))
if (existing) {
  console.log(`Демо-аккаунт "${login}" уже существует — ничего не меняю.`)
  process.exit(0)
}

const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString('base64url')
await createTenant(db, {
  venue: 'NeoPos Demo',
  ownerName: 'Demo Owner',
  login,
  password,
  lang: 'ru',
})

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../data/demo-credentials.txt')
writeFileSync(file, `login: ${login}\npassword: ${password}\n`)
console.log(`Демо-заведение создано. Данные для входа: ${file}`)
process.exit(0)
