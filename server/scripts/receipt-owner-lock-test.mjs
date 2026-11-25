// Чек: смена сотрудника, смена способа продажи, блокировка.
// Запуск: node server/scripts/receipt-owner-lock-test.mjs <логин> <пароль>   (после pos-flow-test)
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
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.transfer', 'receipt.reopen', 'receipt.discount', 'receipt.see_all'])] }, owner)
const act = await j('POST', '/pos/activate', { login, password, name: 'Owner lock test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiterTok = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const waiterId = JSON.parse(Buffer.from(waiterTok.split('.')[1], 'base64url').toString()).sub
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const dish = boot.products.find((p) => p.price > 0 && !p.byWeight)
const hallType = boot.saleTypes.find((x) => x.kind === 'hall')
const away = boot.saleTypes.find((x) => x.kind === 'takeaway')
const busy = (await j('GET', '/pos/receipts', null, admin)).busyTables
const table = boot.halls.flatMap((h) => h.tables).find((t) => !busy.includes(t.id))

let r = await j('POST', '/pos/receipts', { tableId: table.id, guests: 2 }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: dish.id, qty: 1000 }, admin)

// ── Смена сотрудника ──
const list = await j('GET', '/pos/waiters', null, admin)
ok('waiters list has kassa staff', list.s === 200 && list.list.some((u) => u.id === waiterId) && list.list.every((u) => u.name))
ok('waiter without the right cannot take a receipt', (await j('POST', `/pos/receipts/${r.id}/waiter`, { waiterId }, waiterTok)).s === 403)
ok('unknown employee -> 400', (await j('POST', `/pos/receipts/${r.id}/waiter`, { waiterId: '00000000-0000-4000-8000-000000000000' }, admin)).error === 'bad_waiter')
r = await j('POST', `/pos/receipts/${r.id}/waiter`, { waiterId }, admin)
ok('receipt moved to the waiter', r.s === 200 && r.waiterId === waiterId && !!r.waiterName)
ok('the waiter now sees and can edit it', (await j('POST', `/pos/receipts/${r.id}/items`, { productId: dish.id, qty: 1000 }, waiterTok)).s === 200)
r = await j('GET', `/pos/receipts/${r.id}`, null, admin)

// ── Блокировка ──
r = await j('POST', `/pos/receipts/${r.id}/lock`, { locked: true }, waiterTok)
ok('waiter locked the receipt', r.s === 200 && r.locked === true)
ok('locked: adding an item is refused', (await j('POST', `/pos/receipts/${r.id}/items`, { productId: dish.id, qty: 1000 }, admin)).error === 'receipt_locked')
ok('locked: discount is refused', (await j('POST', `/pos/receipts/${r.id}/discount`, { kind: 'percent', value: 10 }, admin)).error === 'receipt_locked')
ok('locked: moving is refused', (await j('POST', `/pos/receipts/${r.id}/sale-type`, { saleTypeId: away.id }, admin)).error === 'receipt_locked')
ok('locked: bill can still be printed', (await j('POST', `/pos/receipts/${r.id}/bill`, null, admin)).s === 200)
ok('waiter cannot unlock', (await j('POST', `/pos/receipts/${r.id}/lock`, { locked: false }, waiterTok)).s === 403)
r = await j('POST', `/pos/receipts/${r.id}/lock`, { locked: false }, admin)
ok('admin unlocked', r.s === 200 && r.locked === false)
ok('after unlock editing works', (await j('POST', `/pos/receipts/${r.id}/items`, { productId: dish.id, qty: 1000 }, admin)).s === 200)

// ── Смена способа продажи ──
r = await j('GET', `/pos/receipts/${r.id}`, null, admin)
const tableSvc = r.serviceBp
r = await j('POST', `/pos/receipts/${r.id}/sale-type`, { saleTypeId: away.id }, admin)
ok('to takeaway: leaves the table, service from the sale type', r.s === 200 && r.saleTypeId === away.id && r.tableId === null && r.serviceBp === away.serviceBp, `bp=${r.serviceBp} want=${away.serviceBp}`)
const sub = dish.price * 3
ok('total recalculated', r.subtotal === sub && r.total === sub + Math.round((sub * away.serviceBp) / 10000))
ok('table is free again', !(await j('GET', '/pos/receipts', null, admin)).busyTables.includes(table.id))
r = await j('POST', `/pos/receipts/${r.id}/sale-type`, { saleTypeId: hallType.id }, admin)
ok('back to hall without a table: service of the hall sale type', r.saleTypeId === hallType.id && r.tableId === null && r.serviceBp === hallType.serviceBp, `was ${tableSvc}`)
ok('unknown sale type -> 400', (await j('POST', `/pos/receipts/${r.id}/sale-type`, { saleTypeId: '00000000-0000-4000-8000-000000000000' }, admin)).error === 'bad_sale_type')

// ── Заблокированный чек можно оплатить; история ──
await j('POST', `/pos/receipts/${r.id}/lock`, { locked: true }, admin)
const full = await j('GET', `/pos/receipts/${r.id}`, null, admin)
ok('locked receipt can be paid', (await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, admin)).s === 200)
const hist = (await j('GET', `/reports/history?from=${today}&to=${today}`, null, owner)).rows.filter((x) => x.receiptId === r.id).map((x) => x.action)
ok('history has waiter, lock, unlock and sale type', ['receipt.waiter', 'receipt.lock', 'receipt.unlock', 'receipt.sale_type'].every((a) => hist.includes(a)), hist.join(','))

// ── Панель: главный терминал ──
const before = (await j('GET', '/terminals', null, owner)).terminals
ok('terminals have main-terminal fields', before.every((t) => 'main' in t && 'syncOnline' in t))
const pull = await j('GET', '/sync/pull', null, act.deviceToken)
const after = (await j('GET', '/terminals', null, owner)).terminals
const mine = after.filter((t) => t.main && t.syncOnline)
ok('a terminal that syncs is shown as the main one, online', pull.s === 200 && mine.length >= 1 && !!mine[0].syncAt, JSON.stringify(mine.map((t) => t.name)))

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
