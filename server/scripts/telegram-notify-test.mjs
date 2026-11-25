// Telegram-бот: привязка чата, уведомления, команда /report. Настоящий Telegram не нужен:
// тест сам поднимает поддельный сервер Telegram и смотрит, что ему прислали.
// Нужен файл server/data/dev.env (в репозиторий не попадает):
//   TELEGRAM_BOT_TOKEN=<любой проверочный токен>
//   TELEGRAM_API_URL=http://127.0.0.1:4999
//   TELEGRAM_POLL_MS=1500
// Запуск: node server/scripts/telegram-notify-test.mjs <логин> <пароль>   (после pos-flow-test)
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const [login, password] = process.argv.slice(2)
const env = Object.fromEntries(
  readFileSync(new URL('../data/dev.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const TOKEN = env.TELEGRAM_BOT_TOKEN
const j = async (m, p, body, t, headers = {}) => {
  const r = await fetch(B + p, {
    method: m,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  return Array.isArray(d) ? { s: r.status, list: d } : { s: r.status, ...d }
}
let failed = 0
const ok = (name, cond, extra = '') => {
  if (!cond) failed++
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''))
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Поддельный Telegram ──
const CHAT = String(7_000_000_000 + Math.floor(Math.random() * 1e8))
const BLOCKED = String(8_000_000_000 + Math.floor(Math.random() * 1e8))
const sent = []
const fake = createServer((req, res) => {
  let text = ''
  req.on('data', (c) => (text += c))
  req.on('end', () => {
    const body = JSON.parse(text || '{}')
    const method = req.url.split('/').pop()
    res.setHeader('Content-Type', 'application/json')
    if (!req.url.startsWith(`/bot${TOKEN}/`)) return res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }))
    if (method === 'sendMessage' && String(body.chat_id) === BLOCKED) return res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }))
    if (method === 'sendMessage') sent.push({ chat: String(body.chat_id), text: body.text })
    res.end(JSON.stringify({ ok: true, result: {} }))
  })
})
await new Promise((r) => fake.listen(4999, '127.0.0.1', r))
const mine = () => sent.filter((m) => m.chat === CHAT)
/** Ждём сообщение, подходящее под условие (рассылка идёт раз в 1,5 секунды). */
const until = async (pred, ms = 9000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(300)) {
    const m = mine().find(pred)
    if (m) return m
  }
  return null
}

/** Строка, которую Telegram передаёт мини-приложению: подписана токеном бота. */
const initData = (id, age = 0) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'AAtest', user: JSON.stringify({ id: Number(id), first_name: 'Test' }) })
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  p.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(check).digest('hex'))
  return p.toString()
}

try {
  const { token: owner } = await j('POST', '/auth/login', { login, password })
  const roles = (await j('GET', '/roles', null, owner)).list
  const adminRole = roles.find((x) => !x.isOwner && x.panelAccess && x.terminalAccess)
  await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.discount'])] }, owner)
  const act = await j('POST', '/pos/activate', { login, password, name: 'Telegram test' })
  const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
  const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
  const boot = await j('GET', '/pos/bootstrap', null, admin)
  if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
  const takeaway = boot.saleTypes.find((x) => x.kind === 'takeaway')
  const prod = await j('POST', '/products', { name: { uz: 'Tg item ' + Date.now(), ru: '' }, price: 10000 }, owner)
  const unpaid = async () => {
    let r = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
    r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: prod.id, qty: 2000 }, admin)
    await j('POST', `/pos/receipts/${r.id}/close-unpaid`, null, admin)
    return r
  }

  const status = await j('GET', '/telegram/status')
  ok('bot is configured on the dev server', status.configured === true, 'restart the dev server after creating server/data/dev.env')

  // ── Привязка ──
  ok('forged data -> 400', (await j('POST', '/telegram/link', { initData: initData(CHAT).replace(/hash=\w{6}/, 'hash=000000') }, owner)).s === 400)
  ok('stale data (2 days old) -> 400', (await j('POST', '/telegram/link', { initData: initData(CHAT, 2 * 86400) }, owner)).s === 400)
  ok('employee without the reports right cannot link', (await j('POST', '/telegram/link', { initData: initData(CHAT) }, waiter)).s === 403)
  ok('without login -> 401', (await j('POST', '/telegram/link', { initData: initData(CHAT) })).s === 401)
  let st = await j('POST', '/telegram/link/state', { initData: initData(CHAT) }, owner)
  ok('not linked yet', st.s === 200 && st.linked === false)

  // Действие ДО привязки: о нём сообщать не нужно
  const old = await unpaid()
  await wait(500)
  st = await j('POST', '/telegram/link', { initData: initData(CHAT), lang: 'ru' }, owner)
  ok('linked, bot confirmed with a message', st.s === 200 && st.linked && st.sent === true && st.notify.digest && st.notify.shift && st.notify.suspicious)
  ok('welcome message names the venue', !!(await until((m) => m.text.includes('Уведомления для') && m.text.includes('/report'), 2000)))
  st = await j('POST', '/telegram/link/state', { initData: initData(CHAT) }, owner)
  ok('state: linked', st.linked === true)

  // ── Подозрительное действие ──
  const r1 = await unpaid()
  const m1 = await until((m) => m.text.includes('Чек закрыт без оплаты') && m.text.includes(`№${r1.number}`))
  ok('unpaid close -> alert with receipt number, sum and employee', !!m1 && m1.text.includes('20 000') && m1.text.includes('Сотрудник:'), m1?.text.replace(/\n/g, ' | ') ?? 'no message')
  await wait(3500)
  ok('sent once, not on every pass', mine().filter((m) => m.text.includes(`№${r1.number}`)).length === 1)
  ok('what happened before linking is not sent', !mine().some((m) => m.text.includes(`№${old.number}`)))
  // Обычная продажа — тишина
  const before = mine().length
  let r2 = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
  r2 = await j('POST', `/pos/receipts/${r2.id}/items`, { productId: prod.id, qty: 1000 }, admin)
  await j('POST', `/pos/receipts/${r2.id}/pay`, { payments: [{ methodId: boot.paymentMethods.find((m) => m.kind === 'cash').id, amount: r2.total }] }, admin)
  await wait(3500)
  ok('ordinary sale -> no message', mine().filter((m) => m.text.includes('⚠️')).length === mine().slice(0, before).filter((m) => m.text.includes('⚠️')).length)

  // Выключили «подозрительные» — тишина
  st = await j('POST', '/telegram/link', { initData: initData(CHAT), lang: 'ru', notify: { suspicious: false } }, owner)
  ok('one switch off, others stay on', st.notify.suspicious === false && st.notify.digest === true && st.notify.shift === true && st.sent === true)
  const r3 = await unpaid()
  await wait(3500)
  ok('switched off -> no alert', !mine().some((m) => m.text.includes(`№${r3.number}`)))
  await j('POST', '/telegram/link', { initData: initData(CHAT), lang: 'ru', notify: { suspicious: true } }, owner)
  await wait(3500)
  ok('switching back on does not resend the old one', !mine().some((m) => m.text.includes(`№${r3.number}`)))

  // ── Ежедневная сводка ──
  const hour = new Date(Date.now() + 5 * 3600_000).getUTCHours()
  const digests = mine().filter((m) => m.text.startsWith('📊 Сводка за'))
  ok('daily digest: at most one per day', digests.length <= 1, `sent ${digests.length} (hour ${hour}; none is fine before 09:00 or after a day without sales)`)

  // ── Закрытие смены (только если нет открытых чеков — чужие чеки тест не трогает) ──
  const sh = await j('GET', '/pos/shift', null, admin)
  if (sh.summary && sh.summary.openReceipts === 0) {
    const c = await j('POST', '/pos/shift/close', { countedCash: sh.summary.expectedCash + 5000 }, admin)
    const ms = await until((m) => m.text.includes('Смена №') && m.text.includes('закрыта'))
    ok('shift close -> message with the cash difference', c.s === 200 && !!ms && ms.text.includes('Расхождение: +5 000'), ms?.text.replace(/\n/g, ' | ') ?? 'no message')
    await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
  } else console.log('SKIP  shift close message (there are open receipts in the dev database)')

  // ── Закрытие смены, пришедшее с главного терминала заведения (обмен с облаком, с опозданием) ──
  const tid = JSON.parse(Buffer.from(act.deviceToken.split('.')[1], 'base64url').toString()).tid
  const shiftNo = (await j('GET', '/pos/bootstrap', null, admin)).shift.number
  const row = { id: crypto.randomUUID(), tenantId: tid, userId: null, receiptId: null, action: 'shift.close', suspicious: true, data: { number: shiftNo, expectedCash: 100000, countedCash: 95000 }, createdAt: new Date().toISOString() }
  const push = () => j('POST', '/sync/push', { auditLog: [row] }, act.deviceToken)
  ok('main terminal pushed a shift close', (await push()).s === 200)
  const mp = await until((m) => m.text.includes('Смена №' + shiftNo + ' закрыта'))
  ok('shift close -> revenue, cash and the difference', !!mp && mp.text.includes('Выручка:') && mp.text.includes('Наличные по программе: 100 000') && mp.text.includes('Расхождение: −5 000'), mp?.text.replace(/\n/g, ' | ') ?? 'no message')
  await push()
  await wait(3500)
  ok('the same record pushed again -> no second message', mine().filter((m) => m.text.includes('Смена №' + shiftNo + ' закрыта')).length === 1)

  // ── Команда /report ──
  const secret = createHmac('sha256', TOKEN).update('neopos-telegram-webhook').digest('hex')
  const hook = (chat, text, s = secret) => j('POST', '/telegram/webhook', { message: { chat: { id: Number(chat), type: 'private' }, text, from: { language_code: 'ru' } } }, null, { 'x-telegram-bot-api-secret-token': s })
  ok('webhook without the secret -> 401', (await hook(CHAT, '/report', 'x')).s === 401)
  const rep = await hook(CHAT, '/report')
  ok('/report -> today digest in the reply', rep.s === 200 && rep.method === 'sendMessage' && rep.text.startsWith('📊 Сводка за') && rep.text.includes('Главное'), rep.text?.split('\n')[0])
  const stranger = await hook('5550001', '/report')
  ok('/report from an unlinked chat -> hint, no data', stranger.method === 'sendMessage' && stranger.text.includes('Уведомления в Telegram') && !stranger.text.includes('Выручка'))
  const hello = await hook(CHAT, '/start')
  ok('/start -> greeting with the button', hello.text.includes('NeoPos') && !!hello.reply_markup)

  // ── Получатель остановил бота ──
  const b = await j('POST', '/telegram/link', { initData: initData(BLOCKED), lang: 'ru' }, owner)
  ok('bot cannot write -> the page is told so', b.s === 200 && b.linked && b.sent === false)
  const r4 = await unpaid()
  ok('others still get the alert', !!(await until((m) => m.text.includes(`№${r4.number}`))))
  await wait(1000)
  ok('blocked chat is unlinked', (await j('POST', '/telegram/link/state', { initData: initData(BLOCKED) }, owner)).linked === false)

  // ── Отключение ──
  st = await j('POST', '/telegram/unlink', { initData: initData(CHAT) }, owner)
  ok('unlinked', st.linked === false && (await j('POST', '/telegram/link/state', { initData: initData(CHAT) }, owner)).linked === false)
  const r5 = await unpaid()
  await wait(3500)
  ok('after unlinking -> silence', !mine().some((m) => m.text.includes(`№${r5.number}`)))
  ok('no token leaks into messages', !sent.some((m) => m.text.includes(TOKEN)))
} finally {
  fake.close()
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
