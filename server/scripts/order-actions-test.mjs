// Действия с чеком как в Clopos: перенос стола, изменение цены, угощение, возврат.
// Запуск: node server/scripts/order-actions-test.mjs <логин> <пароль>   (после pos-flow-test)
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
const extra = ['receipt.transfer', 'receipt.change_price', 'receipt.comp', 'receipt.refund']
await j('PATCH', '/roles/' + adminRole.id, { ...pick(adminRole), permissions: [...new Set([...adminRole.permissions, ...extra])] }, panel)

const act = await j('POST', '/pos/activate', { login, password, name: 'Actions test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const open = (await j('GET', '/pos/receipts', null, admin)).busyTables
const free = boot.halls.flatMap((h) => h.tables).filter((t) => !open.includes(t.id))
const [tA, tB, tC] = free
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const prod = boot.products.find((p) => !p.stopped)

let r = await j('POST', '/pos/receipts', { tableId: tA.id, guests: 2 }, admin)
const id = r.id
r = await j('POST', `/pos/receipts/${id}/items`, { productId: prod.id, qty: 2000 }, admin)
const item = r.items[0]
const other = await j('POST', '/pos/receipts', { tableId: tC.id }, admin)

// Перенос стола
ok('waiter cannot move', (await j('POST', `/pos/receipts/${id}/move`, { tableId: tB.id }, waiter)).s === 403)
ok('cannot move to a taken table', (await j('POST', `/pos/receipts/${id}/move`, { tableId: tC.id }, admin)).error === 'table_taken')
r = await j('POST', `/pos/receipts/${id}/move`, { tableId: tB.id }, admin)
ok('move to a free table', r.s === 200 && r.tableId === tB.id && r.tableName === tB.name)
const busy = (await j('GET', '/pos/receipts', null, admin)).busyTables
ok('old table is free, new one is busy', !busy.includes(tA.id) && busy.includes(tB.id))

// Цена
ok('waiter cannot change price', (await j('POST', `/pos/receipts/${id}/items/${item.id}/price`, { price: 1 }, waiter)).s === 403)
r = await j('POST', `/pos/receipts/${id}/items/${item.id}/price`, { price: 10000 }, admin)
ok('price change recalculates', r.items[0].price === 10000 && r.items[0].total === 20000 && r.subtotal === 20000 && r.suspicious === true, `total=${r.total}`)

// Угощение
const second = await j('POST', `/pos/receipts/${id}/items`, { productId: boot.products.find((p) => p.id !== prod.id && !p.stopped).id }, admin)
const gift = second.items.find((i) => i.id !== item.id)
ok('waiter cannot comp', (await j('POST', `/pos/receipts/${id}/items/${gift.id}/comp`, { comp: true }, waiter)).s === 403)
r = await j('POST', `/pos/receipts/${id}/items/${gift.id}/comp`, { comp: true }, admin)
ok('comp item is free', r.subtotal === 20000 && r.items.find((i) => i.id === gift.id).comp === true)
r = await j('POST', `/pos/receipts/${id}/items/${gift.id}/comp`, { comp: false }, admin)
ok('comp can be switched off', r.subtotal === 20000 + gift.total)
r = await j('POST', `/pos/receipts/${id}/items/${gift.id}/comp`, { comp: true }, admin)

// Возврат
ok('open receipt cannot be refunded', (await j('POST', `/pos/receipts/${id}/refund`, null, admin)).error === 'receipt_not_closed')
const before = (await j('GET', '/pos/shift', null, admin)).summary
const paid = await j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: cash, amount: r.total }] }, admin)
ok('pay', paid.s === 200)
const mid = (await j('GET', '/pos/shift', null, admin)).summary
ok('cash in the drawer grew', mid.expectedCash === before.expectedCash + r.total)
ok('waiter cannot refund', (await j('POST', `/pos/receipts/${id}/refund`, null, waiter)).s === 403)
const back = await j('POST', `/pos/receipts/${id}/refund`, null, admin)
ok('refund', back.s === 200 && back.status === 'refunded')
const after = (await j('GET', '/pos/shift', null, admin)).summary
ok('refund takes the money out of the drawer and revenue', after.expectedCash === before.expectedCash && after.revenue === before.revenue)
ok('refund twice -> 409', (await j('POST', `/pos/receipts/${id}/refund`, null, admin)).s === 409)
ok('archive shows the refunded receipt', (await j('GET', '/pos/archive', null, admin)).receipts.some((x) => x.id === id && x.status === 'refunded'))

await j('DELETE', '/pos/receipts/' + other.id, null, admin)
await j('PATCH', '/roles/' + adminRole.id, pick(adminRole), panel)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
