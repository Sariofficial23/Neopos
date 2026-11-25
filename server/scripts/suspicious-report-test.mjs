// Отчёт «Подозрительные действия»: разыгрываем на кассе типичные схемы и проверяем, что отчёт их ловит.
// Запуск: node server/scripts/suspicious-report-test.mjs <логин> <пароль>   (после pos-flow-test)
const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const [login, password] = process.argv.slice(2)
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
const today = new Date(Date.now() + 5 * 3600_000 - 6 * 3600_000).toISOString().slice(0, 10)
const range = `from=${today}&to=${today}`

const { token: owner } = await j('POST', '/auth/login', { login, password })
const act = await j('POST', '/pos/activate', { login, password, name: 'Suspicious test' })
const perms = (await j('GET', '/meta/permissions', null, owner)).terminal
const stamp = String(Date.now()).slice(-6)

// Должность со всеми правами кассы и два новых сотрудника: «нечестный» и «обычный»
const role = await j('POST', '/roles', { name: 'Su role ' + stamp, panelAccess: false, terminalAccess: true, permissions: perms }, owner)
const hire = async (name) => {
  for (let i = 0; i < 40; i++) {
    const pin = String(3000 + Math.floor(Math.random() * 6000))
    const u = await j('POST', '/staff', { name, roleId: role.id, pin }, owner)
    if (u.id) return { id: u.id, name, token: (await j('POST', '/pos/pin', { pin }, act.deviceToken)).token }
  }
  throw new Error('no free pin')
}
const bad = await hire('Su Bad ' + stamp)
const good = await hire('Su Good ' + stamp)

const boot = await j('GET', '/pos/bootstrap', null, bad.token)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, bad.token)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const reason = boot.reasons.find((r) => r.kind === 'void').id
const takeaway = boot.saleTypes.find((x) => x.kind === 'takeaway')
const [a, b] = boot.products.filter((p) => p.price > 0 && !p.byWeight)
const pay = async (id, t) => {
  const full = await j('GET', `/pos/receipts/${id}`, null, t)
  return j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, t)
}
const sale = async (t, productId = a.id, qty = 1000) => {
  let r = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, t)
  r = await j('POST', `/pos/receipts/${r.id}/items`, { productId, qty }, t)
  return r
}

// Обычный сотрудник: три честные продажи и одно удаление до счёта (ошибся — бывает)
for (let i = 0; i < 3; i++) await pay((await sale(good.token)).id, good.token)
let g = await sale(good.token)
g = await j('POST', `/pos/receipts/${g.id}/items`, { productId: b.id, qty: 1000 }, good.token)
await j('POST', `/pos/receipts/${g.id}/send`, null, good.token)
await j('POST', `/pos/receipts/${g.id}/items/${g.items.find((i) => i.productId === b.id).id}/void`, { reasonId: reason }, good.token)
await pay(g.id, good.token)

// «Нечестный»:
// 1. счёт гостю → удаление позиции → оплата меньшей суммы
let r1 = await sale(bad.token)
r1 = await j('POST', `/pos/receipts/${r1.id}/items`, { productId: b.id, qty: 1000 }, bad.token)
await j('POST', `/pos/receipts/${r1.id}/bill`, null, bad.token)
const voided = await j('POST', `/pos/receipts/${r1.id}/items/${r1.items.find((i) => i.productId === b.id).id}/void`, { reasonId: reason }, bad.token)
ok('scenario: item removed after the bill', voided.s === 200, JSON.stringify(voided).slice(0, 120))
await pay(r1.id, bad.token)
// 2. возврат оплаченного чека
const r2 = await sale(bad.token)
await pay(r2.id, bad.token)
ok('scenario: refund', (await j('POST', `/pos/receipts/${r2.id}/refund`, {}, bad.token)).s === 200)
// 3. снижение цены, 4. скидка 30%, 5. угощение
let r3 = await sale(bad.token, a.id, 2000)
r3 = await j('POST', `/pos/receipts/${r3.id}/items`, { productId: b.id, qty: 1000 }, bad.token)
const lineA = r3.items.find((i) => i.productId === a.id)
const lineB = r3.items.find((i) => i.productId === b.id)
ok('scenario: price lowered', (await j('POST', `/pos/receipts/${r3.id}/items/${lineA.id}/price`, { price: Math.round(a.price / 2) }, bad.token)).s === 200)
ok('scenario: 30% discount', (await j('POST', `/pos/receipts/${r3.id}/discount`, { kind: 'percent', value: 30 }, bad.token)).s === 200)
ok('scenario: comp', (await j('POST', `/pos/receipts/${r3.id}/items/${lineB.id}/comp`, { comp: true }, bad.token)).s === 200)
await pay(r3.id, bad.token)
// небольшая скидка 5% подозрительной не считается
const r4 = await sale(bad.token)
await j('POST', `/pos/receipts/${r4.id}/discount`, { kind: 'percent', value: 5 }, bad.token)
await pay(r4.id, bad.token)

// ── Отчёт ──
const rep = await j('GET', `/reports/suspicious?${range}`, null, owner)
ok('report opens', rep.s === 200 && Array.isArray(rep.byUser) && Array.isArray(rep.cases))
const ub = rep.byUser.find((u) => u.userId === bad.id)
const ug = rep.byUser.find((u) => u.userId === good.id)
ok('bad employee: one of each scheme', ub?.counts.void_after_bill === 1 && ub.counts.refund === 1 && ub.counts.price_down === 1 && ub.counts.discount === 1 && ub.counts.comp === 1 && ub.counts.void === 0, JSON.stringify(ub?.counts))
ok('bad employee: amounts', ub?.amounts.void_after_bill === b.price && ub.amounts.refund > 0 && ub.amounts.price_down === a.price - Math.round(a.price / 2) && ub.amounts.comp === b.price, JSON.stringify(ub?.amounts))
ok('bad employee: score 17, high risk', ub?.score === 17 && ub.level === 'high', `${ub?.score} ${ub?.level}`)
ok('bad employee: closed receipts counted (refunded one is not)', ub?.receipts === 3, String(ub?.receipts))
ok('good employee: a void before the bill is only 1 point, low risk', ug?.counts.void === 1 && ug.counts.void_after_bill === 0 && ug.score === 1 && ug.level === 'low' && ug.receipts === 4, JSON.stringify(ug))
// «Выбивается» — балл от 8 и вдвое выше среднего остальных (в демо-заведении у других тоже много пробных действий).
const others = rep.byUser.filter((u) => u.userId !== bad.id)
const avg = others.reduce((s, u) => s + u.score, 0) / others.length
ok('outlier mark follows the rule; the good employee is never marked', ub?.outlier === (ub.score >= 8 && ub.score >= avg * 2) && ug?.outlier === false, `avg others=${avg.toFixed(1)}`)
ok('list is sorted by score', rep.byUser.every((u, i) => i === 0 || rep.byUser[i - 1].score >= u.score))
const mine = rep.cases.filter((c) => c.userId === bad.id)
ok('cases: the 5 schemes with receipt numbers, most dangerous first', mine.length === 5 && mine.every((c) => c.receiptNumber) && mine[0].kind === 'void_after_bill', mine.map((c) => c.kind).join(','))
ok('cases: the small 5% discount is not there', !mine.some((c) => c.receiptNumber === r4.number))
ok('totals', rep.totals.voidAfterBill >= b.price && rep.totals.refunds >= r2.total && rep.totals.comps >= b.price && rep.totals.high >= 1)
ok('kassa-only employee cannot open the report', (await j('GET', `/reports/suspicious?${range}`, null, good.token)).s === 403)
ok('bad range -> 400', (await j('GET', '/reports/suspicious?from=2026-03-10&to=2026-03-01', null, owner)).s === 400)

// Уборка: пробные сотрудники и должность
await j('DELETE', '/staff/' + bad.id, null, owner)
await j('DELETE', '/staff/' + good.id, null, owner)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
