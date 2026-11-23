// Защита вебхука Telegram-бота: без секрета запрос отбрасывается. Запуск: npx tsx scripts/telegram-webhook-test.mjs
import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
process.env.TELEGRAM_BOT_TOKEN = '123:TEST'
const { telegramRoutes } = await import('../src/routes/telegram.ts')
const app = Fastify()
telegramRoutes(app)
const secret = createHmac('sha256', '123:TEST').update('neopos-telegram-webhook').digest('hex')
const post = (headers, payload = {}) => app.inject({ method: 'POST', url: '/api/telegram/webhook', headers, payload })
let failed = 0
const ok = (n, c) => { if (!c) failed++; console.log((c ? 'PASS' : 'FAIL') + '  ' + n) }
ok('no secret -> 401', (await post({})).statusCode === 401)
ok('wrong secret -> 401', (await post({ 'x-telegram-bot-api-secret-token': 'x'.repeat(64) })).statusCode === 401)
ok('right secret, no message -> 200', (await post({ 'x-telegram-bot-api-secret-token': secret })).statusCode === 200)
ok('group chat ignored -> 200', (await post({ 'x-telegram-bot-api-secret-token': secret }, { message: { chat: { id: 1, type: 'group' } } })).statusCode === 200)
delete process.env.TELEGRAM_BOT_TOKEN
ok('bot not configured -> 404', (await post({ 'x-telegram-bot-api-secret-token': secret })).statusCode === 404)
console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0)
