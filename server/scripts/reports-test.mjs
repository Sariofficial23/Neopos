// Проверка отчётов: создаёт отдельное тестовое заведение, проводит продажи с известными
// суммами и сверяет цифры. Запуск на сервере разработки: node server/scripts/reports-test.mjs
import { randomBytes } from 'node:crypto'

const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const j = async (m, p, body, t) => {
  const r = await fetch(B + p, {
    method: m,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
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

const login = 'rt' + randomBytes(4).toString('hex')
const password = randomBytes(9).toString('base64url')
const { token: T } = await j('POST', '/auth/register', { venue: 'Report Test', name: 'Owner', login, password, lang: 'ru' })
const cat = await j('POST', '/categories', { name: { ru: 'Еда' } }, T)
const A = await j('POST', '/products', { name: { ru: 'A' }, price: 10000, categoryId: cat.id }, T)
const Bp = await j('POST', '/products', { name: { ru: 'B' }, price: 5000 }, T)
const hall = await j('POST', '/halls', { name: 'Зал' }, T)
const table = await j('POST', '/tables', { hallId: hall.id, name: '1' }, T)
const me = (await j('GET', '/staff', null, T)).list[0]
await j('PATCH', '/staff/' + me.id, { name: me.name, roleId: me.roleId, login, pin: '7777', lang: 'ru', active: true }, T)

const act = await j('POST', '/pos/activate', { login, password, name: 'k' })
const P = (await j('POST', '/pos/pin', { pin: '7777' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, P)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const card = boot.paymentMethods.find((m) => m.kind === 'card').id
await j('POST', '/pos/shift/open', { openingCash: 0 }, P)

// Чек 1: с собой, без обслуживания: 2×A + 1×B = 25 000, наличные 30 000 (сдача 5 000)
let r = await j('POST', '/pos/receipts', {}, P)
await j('POST', `/pos/receipts/${r.id}/items`, { productId: A.id, qty: 2000 }, P)
await j('POST', `/pos/receipts/${r.id}/items`, { productId: Bp.id }, P)
await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: 30000 }] }, P)

// Чек 2: стол, обслуживание 10%: A + B, B удалён после отправки → 10 000 + 1 000 = 11 000, карта
r = await j('POST', '/pos/receipts', { tableId: table.id, guests: 2 }, P)
await j('POST', `/pos/receipts/${r.id}/items`, { productId: A.id }, P)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: Bp.id }, P)
await j('POST', `/pos/receipts/${r.id}/send`, null, P)
const reason = boot.reasons.find((x) => x.kind === 'void').id
await j('POST', `/pos/receipts/${r.id}/items/${r.items[1].id}/void`, { reasonId: reason }, P)
await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: card, amount: 11000 }] }, P)
const second = r.id

// Чек 3: открыт и не оплачен — в выручку попадать не должен
const open = await j('POST', '/pos/receipts', {}, P)
await j('POST', `/pos/receipts/${open.id}/items`, { productId: A.id }, P)

// «Сегодня» по времени Ташкента (UTC+5)
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
const qs = `?from=${today}&to=${today}`
const s = await j('GET', '/reports/summary' + qs, null, T)
ok('summary loads', s.s === 200)
ok('totals', s.totals.receipts === 2 && s.totals.revenue === 36000 && s.totals.average === 18000 && s.totals.guests === 3, JSON.stringify(s.totals))
ok('service and discounts', s.totals.service === 1000 && s.totals.discounts === 0)
ok('voids', s.voids.count === 1 && s.voids.amount === 5000, JSON.stringify(s.voids))
ok('by day is one row for today', s.byDay.length === 1 && s.byDay[0].day === today && s.byDay[0].revenue === 36000, JSON.stringify(s.byDay))
ok('by hour sums to revenue', s.byHour.reduce((a, h) => a + h.revenue, 0) === 36000)
const m = Object.fromEntries(s.byMethod.map((x) => [x.name.ru, x.amount]))
ok('by method: cash net of change, card', m['Наличные'] === 25000 && m['Карта'] === 11000, JSON.stringify(m))
ok('by sale type', s.bySaleType.length === 2 && s.bySaleType.reduce((a, x) => a + x.revenue, 0) === 36000)
ok('by waiter', s.byWaiter.length === 1 && s.byWaiter[0].receipts === 2 && s.byWaiter[0].revenue === 36000)
const pa = s.byProduct.find((p) => p.name.ru === 'A')
const pb = s.byProduct.find((p) => p.name.ru === 'B')
ok('by product excludes voided', pa.qty === 3000 && pa.amount === 30000 && pb.qty === 1000 && pb.amount === 5000, JSON.stringify([pa, pb]))
ok('by category incl. uncategorised', s.byCategory.length === 2 && s.byCategory[0].amount === 30000 && s.byCategory[1].id === null)

const yesterday = new Date(Date.now() + 5 * 3600_000 - 86_400_000).toISOString().slice(0, 10)
const y = await j('GET', `/reports/summary?from=${yesterday}&to=${yesterday}`, null, T)
ok('yesterday is empty', y.totals.receipts === 0 && y.totals.revenue === 0 && y.byDay.length === 0)
ok('bad range -> 400', (await j('GET', `/reports/summary?from=${today}&to=${yesterday}`, null, T)).s === 400)

const list = await j('GET', '/receipts' + qs, null, T)
ok('receipts list', list.total === 3 && list.rows.length === 3, `total=${list.total}`)
ok('filter closed', (await j('GET', `/receipts${qs}&status=closed`, null, T)).total === 2)
ok('filter suspicious', (await j('GET', `/receipts${qs}&suspicious=1`, null, T)).total === 1)
ok('filter by number', (await j('GET', `/receipts${qs}&number=1`, null, T)).total === 1)
const d = await j('GET', '/receipts/' + second, null, T)
ok('detail: voided item with reason', d.items.length === 2 && d.items[1].voided === true && !!d.items[1].reason)
ok('detail: history', d.history.some((h) => h.action === 'item.void' && h.suspicious) && d.history.some((h) => h.action === 'receipt.pay'), d.history.map((h) => h.action).join(','))
ok('detail: payments', d.payments.length === 1 && d.payments[0].amount === 11000)

const sh = await j('GET', '/reports/shifts' + qs, null, T)
ok('shifts report', sh.list.length === 1 && sh.list[0].receipts === 2 && sh.list[0].revenue === 36000 && sh.list[0].closedAt === null)

// Изоляция: чужое заведение не видит этих чеков
const other = await j('POST', '/auth/register', { venue: 'Other', name: 'Other Owner', login: login + 'x', password, lang: 'ru' })
ok('other tenant sees nothing', (await j('GET', '/receipts' + qs, null, other.token)).total === 0)
ok('other tenant cannot open receipt', (await j('GET', '/receipts/' + second, null, other.token)).s === 404)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
