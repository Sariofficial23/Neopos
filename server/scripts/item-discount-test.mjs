// Скидка на отдельную позицию чека: процентом и суммой.
// Запуск: node server/scripts/item-discount-test.mjs <логин> <пароль>   (после pos-flow-test)
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

const { token: owner } = await j('POST', '/auth/login', { login, password })
const roles = (await j('GET', '/roles', null, owner)).list
const adminRole = roles.find((x) => !x.isOwner && x.panelAccess && x.terminalAccess)
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.discount', 'receipt.change_price', 'receipt.transfer'])] }, owner)
const act = await j('POST', '/pos/activate', { login, password, name: 'Item discount test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const takeaway = boot.saleTypes.find((x) => x.kind === 'takeaway')
// Свой товар за 10 000, чтобы суммы были круглыми
const prod = await j('POST', '/products', { name: { uz: 'Disc item ' + Date.now(), ru: '' }, price: 10000 }, owner)
const other = boot.products.find((p) => p.price > 0 && !p.byWeight)

let r = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: prod.id, qty: 2000 }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: other.id, qty: 1000 }, admin)
const line = () => r.items.find((i) => i.productId === prod.id && !i.voided)
const disc = (body, t = admin) => j('POST', `/pos/receipts/${r.id}/items/${line().id}/discount`, body, t)
const svc = (base) => Math.round((base * r.serviceBp) / 10000)

ok('waiter without the right -> 403', (await disc({ kind: 'percent', value: 10 }, waiter)).s === 403)
ok('bad percent -> 400', (await disc({ kind: 'percent', value: 150 })).s === 400)

r = await disc({ kind: 'percent', value: 10 })
ok('10%: line 20 000 -> 18 000', line().total === 18000 && line().discountAmount === 2000 && line().discountPercent === 10, JSON.stringify(line()))
ok('receipt subtotal uses the discounted line', r.subtotal === 18000 + other.price && r.total === r.subtotal + svc(r.subtotal))

// Количество меняется — процент пересчитывается
r = await j('PATCH', `/pos/receipts/${r.id}/items/${line().id}`, { qty: 3000 }, admin)
ok('qty 3: discount recalculated to 3 000', line().total === 27000 && line().discountAmount === 3000)
// Добавление того же товара (сливается в ту же строку) тоже сохраняет скидку
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: prod.id, qty: 1000 }, admin)
ok('adding the same product keeps the percent', line().qty === 4000 && line().total === 36000 && line().discountPercent === 10, JSON.stringify(line()))
// Смена цены
r = await j('POST', `/pos/receipts/${r.id}/items/${line().id}/price`, { price: 5000 }, admin)
ok('price change keeps the percent', line().total === 18000 && line().discountAmount === 2000)

// Скидка суммой заменяет процент
r = await disc({ kind: 'amount', value: 5000 })
ok('amount 5 000: line 20 000 -> 15 000', line().total === 15000 && line().discountAmount === 5000 && line().discountPercent === 0)
r = await disc({ kind: 'amount', value: 999999 })
ok('amount bigger than the line is capped', line().total === 0 && line().discountAmount === 20000)

// Скидка на чек считается после скидки на товар
r = await disc({ kind: 'percent', value: 50 })
r = await j('POST', `/pos/receipts/${r.id}/discount`, { kind: 'percent', value: 10 }, admin)
const sub = 10000 + other.price
ok('receipt discount applies after the item discount', r.subtotal === sub && r.discountAmount === Math.round(sub * 0.1) && r.total === sub - r.discountAmount + svc(sub - r.discountAmount), `${r.subtotal} ${r.discountAmount} ${r.total}`)

// Разделение счёта: скидка уходит вместе с частью позиции
const sp = await j('POST', `/pos/receipts/${r.id}/split`, { items: [{ itemId: line().id, qty: 1000 }] }, admin)
const movedLine = sp.created?.items.find((i) => i.productId === prod.id)
ok('split keeps the item discount on both parts', sp.s === 200 && movedLine?.total === 2500 && movedLine?.discountPercent === 50 && sp.receipt.items.find((i) => i.productId === prod.id)?.total === 7500, JSON.stringify(movedLine))
r = sp.receipt

// Убрать скидку
r = await disc({ kind: 'none' })
ok('discount removed', line().discountAmount === 0 && line().discountPercent === 0 && line().total === 15000)

// История и оплата
const hist = await j('GET', `/reports/history?from=${today}&to=${today}`, null, owner)
ok('history has item discounts, big ones marked suspicious', hist.rows.some((x) => x.receiptId === r.id && x.action === 'item.discount' && x.suspicious) && hist.rows.some((x) => x.receiptId === r.id && x.action === 'item.discount' && !x.suspicious))
const full = await j('GET', `/pos/receipts/${r.id}`, null, admin)
ok('paid', (await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, admin)).s === 200)
ok('closed receipt: discount refused', (await disc({ kind: 'percent', value: 10 })).s === 409)
const f2 = await j('GET', `/pos/receipts/${sp.created.id}`, null, admin)
await j('POST', `/pos/receipts/${sp.created.id}/pay`, { payments: [{ methodId: cash, amount: f2.total }] }, admin)
await j('DELETE', '/products/' + prod.id, null, owner)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
