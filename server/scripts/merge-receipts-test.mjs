// «Объединить чеки»: позиции другого открытого чека переходят в этот.
// Запуск: node server/scripts/merge-receipts-test.mjs <логин> <пароль>   (после pos-flow-test)
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
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.transfer'])] }, owner)
const act = await j('POST', '/pos/activate', { login, password, name: 'Merge test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const [a, b] = boot.products.filter((p) => p.price > 0 && !p.byWeight)
const busy = (await j('GET', '/pos/receipts', null, admin)).busyTables
const [t1, t2] = boot.halls.flatMap((h) => h.tables).filter((t) => !busy.includes(t.id))

// Два чека за разными столами
let r1 = await j('POST', '/pos/receipts', { tableId: t1.id, guests: 2 }, admin)
r1 = await j('POST', `/pos/receipts/${r1.id}/items`, { productId: a.id, qty: 2000 }, admin)
let r2 = await j('POST', '/pos/receipts', { tableId: t2.id, guests: 3 }, admin)
r2 = await j('POST', `/pos/receipts/${r2.id}/items`, { productId: b.id, qty: 1000 }, admin)
r2 = await j('POST', `/pos/receipts/${r2.id}/items`, { productId: a.id, qty: 1000 }, admin)

ok('merge with itself -> 400', (await j('POST', `/pos/receipts/${r1.id}/merge`, { fromId: r1.id }, admin)).error === 'same_receipt')
ok('unknown receipt -> 404', (await j('POST', `/pos/receipts/${r1.id}/merge`, { fromId: '00000000-0000-4000-8000-000000000000' }, admin)).s === 404)
ok('waiter without the right -> 403', (await j('POST', `/pos/receipts/${r1.id}/merge`, { fromId: r2.id }, waiter)).s === 403)

const m = await j('POST', `/pos/receipts/${r1.id}/merge`, { fromId: r2.id }, admin)
const subtotal = a.price * 3 + b.price
ok('merged: all items are in the first receipt', m.s === 200 && m.items.filter((i) => !i.voided).length === 3 && m.subtotal === subtotal, `items=${m.items?.length} subtotal=${m.subtotal} want=${subtotal}`)
ok('table and service stay from the first receipt, guests add up', m.tableId === t1.id && m.serviceBp === r1.serviceBp && m.guests === 5)
ok('total recalculated with service', m.total === subtotal + Math.round((subtotal * m.serviceBp) / 10000))
const open = await j('GET', '/pos/receipts', null, admin)
ok('second receipt is no longer open and its table is free', !open.receipts.some((x) => x.id === r2.id) && !open.busyTables.includes(t2.id) && open.busyTables.includes(t1.id))
ok('merged receipt cannot be opened for work again', (await j('POST', `/pos/receipts/${r2.id}/items`, { productId: a.id, qty: 1000 }, admin)).s === 409)
ok('merging an already merged receipt -> 409', (await j('POST', `/pos/receipts/${r1.id}/merge`, { fromId: r2.id }, admin)).s === 409)

// Панель: вкладка «Объединённые» и история
const tab = await j('GET', `/receipts?from=${today}&to=${today}&status=merged`, null, owner)
ok('panel: merged tab has the second receipt with zero total', tab.s === 200 && tab.rows.some((x) => x.id === r2.id && x.total === 0 && x.status === 'merged'))
const hist = await j('GET', `/reports/history?from=${today}&to=${today}`, null, owner)
ok('history: merge on the first, merged on the second', hist.rows.some((x) => x.receiptId === r1.id && x.action === 'receipt.merge') && hist.rows.some((x) => x.receiptId === r2.id && x.action === 'receipt.merged'))

// Оплата объединённого чека; в выручку попадает один чек
const before = await j('GET', `/reports/summary?from=${today}&to=${today}`, null, owner)
const paid = await j('POST', `/pos/receipts/${r1.id}/pay`, { payments: [{ methodId: cash, amount: m.total }] }, admin)
const after = await j('GET', `/reports/summary?from=${today}&to=${today}`, null, owner)
ok('paid; revenue grew by one receipt with the full sum', paid.s === 200 && after.totals.receipts === before.totals.receipts + 1 && after.totals.revenue === before.totals.revenue + m.total)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
