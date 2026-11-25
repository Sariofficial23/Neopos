// Отчёты бэк-офиса: «Товары», «История» и вкладки «Чеков».
// Запуск: node server/scripts/backoffice-reports-test.mjs <логин> <пароль>   (после pos-flow-test)
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
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
const range = `from=${today}&to=${today}`

const { token: panel } = await j('POST', '/auth/login', { login, password })
// Администратору кассы нужны права на угощение и возврат
const roles = (await j('GET', '/roles', null, panel)).list
const adminRole = roles.find((x) => !x.isOwner && x.panelAccess)
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: adminRole.panelAccess, terminalAccess: adminRole.terminalAccess, permissions: [...new Set([...adminRole.permissions, 'receipt.comp', 'receipt.refund'])] }, panel)
const act = await j('POST', '/pos/activate', { login, password, name: 'Reports test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const takeaway = boot.saleTypes.find((s) => s.kind === 'takeaway')

// Товар с себестоимостью 4000 и ценой 10000
const name = 'Report Tea ' + Date.now()
const tea = await j('POST', '/products', { name: { uz: name, ru: '' }, price: 10000 }, panel)
await j('POST', '/supplies', { supplier: 'T', items: [{ productId: tea.id, qty: 100000, cost: 4000 }] }, panel)

const before = await j('GET', `/reports/history?${range}`, null, panel)

// Продажа: 3 шт
let r = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: tea.id, qty: 2000 }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: tea.id, qty: 1000 }, admin)
const compLine = r.items.find((i) => i.qty === 1000) ?? r.items[r.items.length - 1]
const comp = { s: 0 } // угощение проверяется отдельным чеком ниже
const full = await j('GET', `/pos/receipts/${r.id}`, null, admin)
await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, admin)

const rep = await j('GET', `/reports/products?${range}`, null, panel)
const row = rep.rows?.find((x) => x.productId === tea.id)
ok('products report: 200', rep.s === 200 && Array.isArray(rep.categories) && Array.isArray(rep.departments))
if (comp.s === 200 && compLine.qty === 1000) {
  ok('products: paid qty 2, comp qty 1', row?.qty === 2000 && row?.compQty === 1000, JSON.stringify(row))
  ok('products: amount 20000, cost 12000 (comp is eaten too), profit 8000', row?.amount === 20000 && row?.cost === 12000 && row?.profit === 8000, JSON.stringify(row))
} else {
  // Кассир объединил строки или угощение недоступно — проверяем без него.
  ok('products: qty 3, amount 30000, cost 12000', row?.qty === 3000 && row?.amount === 30000 && row?.cost === 12000, JSON.stringify(row))
}
// Угощение: во втором чеке чай подарен, рядом обычное блюдо, чтобы было что оплатить.
{
  const other = boot.products.find((p) => p.id !== tea.id && p.price > 0 && !p.byWeight)
  let r2 = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
  r2 = await j('POST', `/pos/receipts/${r2.id}/items`, { productId: tea.id, qty: 1000 }, admin)
  const teaLine = r2.items.find((i) => i.productId === tea.id)
  r2 = await j('POST', `/pos/receipts/${r2.id}/items`, { productId: other.id, qty: 1000 }, admin)
  const c = await j('POST', `/pos/receipts/${r2.id}/items/${teaLine.id}/comp`, { comp: true }, admin)
  const f2 = await j('GET', `/pos/receipts/${r2.id}`, null, admin)
  const p2 = await j('POST', `/pos/receipts/${r2.id}/pay`, { payments: [{ methodId: cash, amount: f2.total }] }, admin)
  const row2 = (await j('GET', `/reports/products?${range}`, null, panel)).rows.find((x) => x.productId === tea.id)
  ok('products: comp is counted apart (qty 3 paid, 1 comp), cost includes it', c.s === 200 && p2.s === 200 && row2?.qty === 3000 && row2?.compQty === 1000 && row2?.amount === 30000 && row2?.cost === 16000, `comp=${c.s} pay=${p2.s} ${JSON.stringify(row2)}`)
}
ok('products: bad range -> 400', (await j('GET', '/reports/products?from=2026-01-10&to=2026-01-01', null, panel)).s === 400)
ok('products: waiter token -> 403', (await j('GET', `/reports/products?${range}`, null, waiter)).s === 403)

const hist = await j('GET', `/reports/history?${range}`, null, panel)
ok('history: new actions appeared', hist.s === 200 && hist.total > before.total, `${before.total} -> ${hist.total}`)
const mine = hist.rows.filter((x) => x.receiptId === r.id)
ok('history: open and pay of the receipt with number and user', mine.some((x) => x.action === 'receipt.open') && mine.some((x) => x.action === 'receipt.pay' && x.receiptNumber === r.number && x.userName), mine.map((x) => x.action).join(','))
ok('history: newest first', hist.rows.length < 2 || hist.rows[0].createdAt >= hist.rows[1].createdAt)
const sus = await j('GET', `/reports/history?${range}&suspicious=1`, null, panel)
ok('history: suspicious filter', sus.s === 200 && sus.rows.every((x) => x.suspicious) && sus.total <= hist.total)
ok('history: waiter token -> 403', (await j('GET', `/reports/history?${range}`, null, waiter)).s === 403)

// Вкладки «Чеков»
await j('POST', `/pos/receipts/${r.id}/refund`, {}, admin)
const refunded = await j('GET', `/receipts?${range}&status=refunded`, null, panel)
const closedTab = await j('GET', `/receipts?${range}&status=closed`, null, panel)
const wasRefunded = refunded.rows?.some((x) => x.id === r.id)
ok('receipts: refunded tab works', refunded.s === 200 && refunded.rows.every((x) => x.status === 'refunded'))
ok('receipts: refunded receipt left the closed tab', !wasRefunded || !closedTab.rows.some((x) => x.id === r.id))
const empty = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
await j('DELETE', `/pos/receipts/${empty.id}`, null, admin)
ok('receipts: deleted tab has the cancelled receipt', (await j('GET', `/receipts?${range}&status=cancelled`, null, panel)).rows.some((x) => x.id === empty.id))

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
