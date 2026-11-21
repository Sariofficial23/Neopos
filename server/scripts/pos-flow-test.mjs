// Сквозная проверка кассы по HTTP на запущенном сервере разработки.
// Запуск: node server/scripts/pos-flow-test.mjs <логин> <пароль>   (демо-заведение)
const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const [login, password] = process.argv.slice(2)

const j = async (m, p, body, t) => {
  const r = await fetch(B + p, {
    method: m,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: 'Bearer ' + t } : {}),
    },
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

// Официант без прав и администратор с ПИН-кодами
const roles = (await j('GET', '/roles', null, panel)).list
const waiterRole = roles.find((r) => !r.isOwner && !r.panelAccess && r.permissions.length === 0)
const adminRole = roles.find((r) => !r.isOwner && r.panelAccess)
const staff = (await j('GET', '/staff', null, panel)).list
if (!staff.some((s) => s.name === 'Test Waiter'))
  await j('POST', '/staff', { name: 'Test Waiter', roleId: waiterRole.id, pin: '1111' }, panel)
if (!staff.some((s) => s.name === 'Test Admin'))
  await j('POST', '/staff', { name: 'Test Admin', roleId: adminRole.id, pin: '2222' }, panel)

ok('pin without device token -> 401', (await j('POST', '/pos/pin', { pin: '2222' })).s === 401)
ok('pin with panel token -> 401', (await j('POST', '/pos/pin', { pin: '2222' }, panel)).s === 401)
ok('activate bad password -> 401', (await j('POST', '/pos/activate', { login, password: 'nope-nope' })).s === 401)
const act = await j('POST', '/pos/activate', { login, password, name: 'Test kassa' })
ok('activate', act.s === 200 && !!act.deviceToken)
ok('device token cannot read data', (await j('GET', '/pos/bootstrap', null, act.deviceToken)).s === 401)
ok('wrong pin -> 401', (await j('POST', '/pos/pin', { pin: '987650' }, act.deviceToken)).s === 401)
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
ok('pin login admin + waiter', !!admin && !!waiter)

const boot = await j('GET', '/pos/bootstrap', null, admin)
ok('bootstrap', boot.s === 200 && boot.products.length > 0 && boot.halls.length > 0, `products=${boot.products?.length}`)
const P = (name) => boot.products.find((p) => p.name.uz.startsWith(name)).id
const table = boot.halls[0].tables[4].id
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const card = boot.paymentMethods.find((m) => m.kind === 'card').id

// Убираем хвосты прошлых прогонов
if (boot.shift) {
  for (const r of (await j('GET', '/pos/receipts', null, admin)).receipts) {
    const d = await j('DELETE', '/pos/receipts/' + r.id, null, admin)
    if (d.s !== 200) await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: r.total || 1 }] }, admin)
  }
  await j('POST', '/pos/shift/close', { countedCash: 0 }, admin)
}

ok('receipt without shift -> 409', (await j('POST', '/pos/receipts', { tableId: table }, admin)).error === 'shift_closed')
ok('waiter cannot open shift', (await j('POST', '/pos/shift/open', { openingCash: 0 }, waiter)).s === 403)
const sh = await j('POST', '/pos/shift/open', { openingCash: 100000 }, admin)
ok('open shift', sh.s === 200, '#' + sh.number)
ok('second shift -> 409', (await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)).s === 409)

let r = await j('POST', '/pos/receipts', { tableId: table, guests: 3 }, waiter)
ok('waiter opens table receipt', r.s === 200 && r.serviceBp === 1000, `#${r.number}`)
const id = r.id
ok('same table returns same receipt', (await j('POST', '/pos/receipts', { tableId: table }, waiter)).id === id)
await j('POST', `/pos/receipts/${id}/items`, { productId: P('Osh') }, waiter)
await j('POST', `/pos/receipts/${id}/items`, { productId: P('Osh') }, waiter)
r = await j('POST', `/pos/receipts/${id}/items`, { productId: P('Qo'), qty: 4000 }, waiter)
ok('merge unsent lines + totals', r.items.length === 2 && r.subtotal === 164000 && r.serviceAmount === 16400 && r.total === 180400, `total=${r.total}`)
const s1 = await j('POST', `/pos/receipts/${id}/send`, null, waiter)
ok('send to kitchen', s1.sent.length === 2 && s1.receipt.items.every((i) => i.sent))
r = await j('POST', `/pos/receipts/${id}/items`, { productId: P('Osh') }, waiter)
ok('re-order makes a new line', r.items.length === 3)
const osh1 = r.items[0]
const fresh = r.items[2]
ok('cannot edit sent line', (await j('PATCH', `/pos/receipts/${id}/items/${osh1.id}`, { qty: 1000 }, waiter)).error === 'item_already_sent')
r = await j('PATCH', `/pos/receipts/${id}/items/${fresh.id}`, { qty: 0 }, waiter)
ok('remove unsent line', r.items.length === 2)
const reason = boot.reasons.find((x) => x.kind === 'void').id
ok('waiter cannot void sent item', (await j('POST', `/pos/receipts/${id}/items/${osh1.id}/void`, { reasonId: reason }, waiter)).s === 403)
ok('waiter cannot discount', (await j('POST', `/pos/receipts/${id}/discount`, { kind: 'percent', value: 10 }, waiter)).s === 403)
r = await j('POST', `/pos/receipts/${id}/items/${r.items[1].id}/void`, { reasonId: reason }, admin)
ok('admin voids sent item', r.subtotal === 76000 && r.suspicious === true, `subtotal=${r.subtotal}`)
r = await j('POST', `/pos/receipts/${id}/discount`, { kind: 'percent', value: 10 }, admin)
ok('discount 10% then service 10%', r.discountAmount === 7600 && r.serviceAmount === 6840 && r.total === 75240, `total=${r.total}`)
ok('underpay -> 409', (await j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: cash, amount: 1000 }] }, waiter)).error === 'not_enough_paid')
ok('card overpay -> 409', (await j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: card, amount: 80000 }] }, waiter)).error === 'overpaid_non_cash')
ok('close shift with open receipt -> 409', (await j('POST', '/pos/shift/close', { countedCash: 0 }, admin)).error === 'open_receipts')
const pay = await j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: card, amount: 40000 }, { methodId: cash, amount: 50000 }] }, waiter)
ok('split payment with change', pay.s === 200 && pay.change === 14760 && pay.receipt.status === 'closed', `change=${pay.change}`)
ok('paid receipt is locked', (await j('POST', `/pos/receipts/${id}/items`, { productId: P('Osh') }, waiter)).error === 'receipt_closed')

// Чек без стола, чужой чек, пустой чек
const t2 = await j('POST', '/pos/receipts', {}, admin)
ok('takeaway receipt has no service', t2.s === 200 && t2.serviceBp === 0 && t2.tableId === null)
ok('waiter cannot open admin receipt', (await j('GET', '/pos/receipts/' + t2.id, null, waiter)).s === 403)
ok('waiter list hides it', (await j('GET', '/pos/receipts', null, waiter)).receipts.length === 0)
ok('pay empty -> 409', (await j('POST', `/pos/receipts/${t2.id}/pay`, { payments: [{ methodId: cash, amount: 1 }] }, admin)).error === 'receipt_empty')
ok('cancel empty receipt', (await j('DELETE', '/pos/receipts/' + t2.id, null, admin)).s === 200)

const sum = await j('GET', '/pos/shift', null, admin)
ok('shift summary', sum.summary.receipts === 1 && sum.summary.revenue === 75240 && sum.summary.expectedCash === 135240, JSON.stringify({ rev: sum.summary.revenue, cash: sum.summary.expectedCash }))
const cl = await j('POST', '/pos/shift/close', { countedCash: 135000 }, admin)
ok('close shift', cl.s === 200 && cl.shift.countedCash === 135000)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
