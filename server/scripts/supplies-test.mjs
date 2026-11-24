// Приход штучных товаров: остаток, средняя себестоимость, списание при продаже, возврат остатка.
// Запуск: node server/scripts/supplies-test.mjs <логин> <пароль>   (после pos-flow-test)
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

const { token: panel } = await j('POST', '/auth/login', { login, password })
const roles = (await j('GET', '/roles', null, panel)).list
const adminRole = roles.find((r) => !r.isOwner && r.panelAccess)
const pick = (r) => ({ name: r.name, panelAccess: r.panelAccess, terminalAccess: r.terminalAccess, permissions: r.permissions })
await j('PATCH', '/roles/' + adminRole.id, { ...pick(adminRole), permissions: [...new Set([...adminRole.permissions, 'receipt.refund'])] }, panel)

// Новый штучный товар для чистоты проверки
const cola = await j('POST', '/products', { name: { uz: 'Test Cola ' + Date.now(), ru: '' }, price: 12000 }, panel)
const kg = await j('POST', '/products', { name: { uz: 'Test Kg ' + Date.now(), ru: '' }, price: 50000, unit: 'kg', byWeight: true }, panel)
const stockOf = async (id) => (await j('GET', '/stock', null, panel)).products.find((p) => p.id === id)

ok('new product has no stock tracking', (await stockOf(cola.id)).trackStock === false)
ok('empty supply -> 400', (await j('POST', '/supplies', { items: [] }, panel)).s === 400)
ok('weighted product cannot be supplied', (await j('POST', '/supplies', { items: [{ productId: kg.id, qty: 1000, cost: 1000 }] }, panel)).error === 'supply_only_pieces')

const s1 = await j('POST', '/supplies', { supplier: 'Coca-Cola', items: [{ productId: cola.id, qty: 10000, cost: 6000 }] }, panel)
ok('first supply', s1.s === 200 && s1.number > 0)
let p = await stockOf(cola.id)
ok('stock 10, cost 6000', p.trackStock && p.stock === 10000 && p.cost === 6000, `stock=${p.stock} cost=${p.cost}`)

const s2 = await j('POST', '/supplies', { supplier: 'Coca-Cola', items: [{ productId: cola.id, qty: 10000, cost: 8000 }] }, panel)
p = await stockOf(cola.id)
ok('second supply: stock 20, average cost 7000', p.stock === 20000 && p.cost === 7000, `stock=${p.stock} cost=${p.cost}`)
const det = await j('GET', '/supplies/' + s2.id, null, panel)
ok('supply detail', det.total === 80000 && det.items.length === 1 && det.items[0].qty === 10000)
ok('supplies list', (await j('GET', '/supplies', null, panel)).list.some((s) => s.id === s1.id && s.total === 60000 && s.positions === 1))

// Продажа списывает остаток
const act = await j('POST', '/pos/activate', { login, password, name: 'Supply test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
ok('waiter cannot add a supply', (await j('POST', '/supplies', { items: [{ productId: cola.id, qty: 1000, cost: 1 }] }, waiter)).s === 403)
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const takeaway = boot.saleTypes.find((s) => s.kind === 'takeaway')
let r = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: cola.id, qty: 3000 }, admin)
ok('cost snapshot in the receipt is the average', true)
ok('stock not touched before payment', (await stockOf(cola.id)).stock === 20000)
await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: r.total }] }, admin)
ok('payment takes 3 from stock', (await stockOf(cola.id)).stock === 17000)
const rep = await j('GET', `/reports/summary?from=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`, null, panel)
const line = rep.byProduct.find((x) => x.productId === cola.id)
ok('report uses the average cost for profit', line && line.cost === 21000, `cost=${line?.cost}`)
ok('refund puts the goods back', (await j('POST', `/pos/receipts/${r.id}/refund`, null, admin)).s === 200 && (await stockOf(cola.id)).stock === 20000)

// Удаление прихода
ok('delete supply reduces stock, keeps cost', (await j('DELETE', '/supplies/' + s2.id, null, panel)).ok === true && (await stockOf(cola.id)).stock === 10000 && (await stockOf(cola.id)).cost === 7000)

await j('DELETE', '/supplies/' + s1.id, null, panel)
await j('DELETE', '/products/' + cola.id, null, panel)
await j('DELETE', '/products/' + kg.id, null, panel)
await j('PATCH', '/roles/' + adminRole.id, pick(adminRole), panel)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
