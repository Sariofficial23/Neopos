// «Разделить счёт»: часть позиций уходит в новый чек за тем же столом.
// Запуск: node server/scripts/split-receipt-test.mjs <логин> <пароль>   (после pos-flow-test)
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

const { token: owner } = await j('POST', '/auth/login', { login, password })
const roles = (await j('GET', '/roles', null, owner)).list
const adminRole = roles.find((x) => !x.isOwner && x.panelAccess && x.terminalAccess)
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.transfer', 'receipt.discount'])] }, owner)
const act = await j('POST', '/pos/activate', { login, password, name: 'Split test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const [a, b] = boot.products.filter((p) => p.price > 0 && !p.byWeight)
const busy = (await j('GET', '/pos/receipts', null, admin)).busyTables
const table = boot.halls.flatMap((h) => h.tables).find((t) => !busy.includes(t.id))

// Чек за столом: 3 × A и 1 × B, скидка 10%
let r = await j('POST', '/pos/receipts', { tableId: table.id, guests: 3 }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: a.id, qty: 3000 }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: b.id, qty: 1000 }, admin)
r = await j('POST', `/pos/receipts/${r.id}/discount`, { kind: 'percent', value: 10 }, admin)
const itemA = r.items.find((i) => i.productId === a.id)
const itemB = r.items.find((i) => i.productId === b.id)
const before = r.total
const svc = r.serviceBp

ok('nothing selected -> 400', (await j('POST', `/pos/receipts/${r.id}/split`, { items: [] }, admin)).s === 400)
ok('more than there is -> 400', (await j('POST', `/pos/receipts/${r.id}/split`, { items: [{ itemId: itemA.id, qty: 4000 }] }, admin)).error === 'bad_qty')
ok('everything -> 400', (await j('POST', `/pos/receipts/${r.id}/split`, { items: [{ itemId: itemA.id, qty: 3000 }, { itemId: itemB.id, qty: 1000 }] }, admin)).error === 'split_all')
ok('waiter without the right -> 403', (await j('POST', `/pos/receipts/${r.id}/split`, { items: [{ itemId: itemA.id, qty: 1000 }] }, waiter)).s === 403)

// Разделить: 1 × A и весь B — в новый чек
const sp = await j('POST', `/pos/receipts/${r.id}/split`, { items: [{ itemId: itemA.id, qty: 1000 }, { itemId: itemB.id, qty: 1000 }] }, admin)
ok('split done', sp.s === 200 && sp.created?.number > r.number, JSON.stringify(sp).slice(0, 120))
const left = sp.receipt
const made = sp.created
ok('original keeps 2 × A', left.items.filter((i) => !i.voided).length === 1 && left.items[0].qty === 2000 && left.items[0].total === a.price * 2)
ok('new receipt has 1 × A and 1 × B', made.items.length === 2 && made.items.some((i) => i.productId === a.id && i.qty === 1000 && i.total === a.price) && made.items.some((i) => i.id === itemB.id))
ok('same table, waiter, service and percent discount', made.tableId === table.id && made.waiterId === left.waiterId && made.serviceBp === svc && made.discountKind === 'percent' && made.discountValue === 10)
ok('totals add up to the original (within rounding)', Math.abs(left.total + made.total - before) <= 2, `${left.total} + ${made.total} vs ${before}`)
const list = await j('GET', '/pos/receipts', null, admin)
ok('both receipts are open on the table', list.receipts.filter((x) => x.tableId === table.id).length === 2)
ok('history has the split', (await j('GET', `/pos/receipts/${r.id}/history`, null, admin)).list?.some((h) => h.action === 'receipt.split') ?? true)

// Обе части оплачиваются отдельно
const p1 = await j('POST', `/pos/receipts/${made.id}/pay`, { payments: [{ methodId: cash, amount: made.total }] }, admin)
ok('new receipt paid, table still busy with the first', p1.s === 200 && (await j('GET', '/pos/receipts', null, admin)).busyTables.includes(table.id))
const p2 = await j('POST', `/pos/receipts/${left.id}/pay`, { payments: [{ methodId: cash, amount: left.total }] }, admin)
ok('original paid, table free', p2.s === 200 && !(await j('GET', '/pos/receipts', null, admin)).busyTables.includes(table.id))
ok('closed receipt cannot be split', (await j('POST', `/pos/receipts/${left.id}/split`, { items: [{ itemId: left.items[0].id, qty: 1000 }] }, admin)).s === 409)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
