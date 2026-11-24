// Цвета столов (время простоя), история чека на кассе, «Открыть чек ещё раз».
// Запуск: node server/scripts/clopos-batch2-test.mjs <логин> <пароль>   (после pos-flow-test)
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
await j('PATCH', '/roles/' + adminRole.id, { ...pick(adminRole), permissions: [...new Set([...adminRole.permissions, 'receipt.reopen'])] }, panel)

// Настройка «Изменение цвета стола»
const s0 = await j('GET', '/settings', null, panel)
ok('setting defaults to a number', typeof s0.tableRedMinutes === 'number')
ok('over 1000 minutes -> 400', (await j('PATCH', '/settings', { ...s0, tableRedMinutes: 5000 }, panel)).s === 400)
ok('save 30 minutes', (await j('PATCH', '/settings', { ...s0, tableRedMinutes: 30 }, panel)).tableRedMinutes === 30)

const act = await j('POST', '/pos/activate', { login, password, name: 'Batch2 test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
ok('kassa gets the setting', boot.tableRedMinutes === 30)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const busy = (await j('GET', '/pos/receipts', null, admin)).busyTables
const free = boot.halls.flatMap((h) => h.tables).filter((t) => !busy.includes(t.id))
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const prod = boot.products.find((p) => !p.stopped)

let r = await j('POST', '/pos/receipts', { tableId: free[0].id }, admin)
const id = r.id
let row = (await j('GET', '/pos/receipts', null, admin)).receipts.find((x) => x.id === id)
ok('empty receipt has no last-item time', row && row.lastItemAt === null)
r = await j('POST', `/pos/receipts/${id}/items`, { productId: prod.id }, admin)
row = (await j('GET', '/pos/receipts', null, admin)).receipts.find((x) => x.id === id)
ok('last-item time appears after adding a dish', !!row.lastItemAt && Date.now() - new Date(row.lastItemAt).getTime() < 60_000)

// История чека
await j('POST', `/pos/receipts/${id}/send`, null, admin)
const hist = await j('GET', `/pos/receipts/${id}/history`, null, admin)
ok('history lists open and send', hist.list?.some((h) => h.action === 'receipt.open') && hist.list.some((h) => h.action === 'receipt.send' && h.userName))
ok('waiter cannot read a foreign receipt history', (await j('GET', `/pos/receipts/${id}/history`, null, waiter)).s === 403)

// Открыть чек ещё раз
ok('open receipt cannot be reopened', (await j('POST', `/pos/receipts/${id}/reopen`, null, admin)).error === 'receipt_not_closed')
const before = (await j('GET', '/pos/shift', null, admin)).summary
await j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: cash, amount: r.total }] }, admin)
ok('waiter cannot reopen', (await j('POST', `/pos/receipts/${id}/reopen`, null, waiter)).s === 403)
// Пока чек закрыт, за его стол сел другой гость
const squatter = await j('POST', '/pos/receipts', { tableId: free[0].id }, admin)
ok('cannot reopen onto a taken table', (await j('POST', `/pos/receipts/${id}/reopen`, null, admin)).error === 'table_taken')
await j('DELETE', '/pos/receipts/' + squatter.id, null, admin)
const again = await j('POST', `/pos/receipts/${id}/reopen`, null, admin)
ok('reopen', again.s === 200 && again.status === 'open' && again.payments.length === 0 && again.items.length === 1)
const after = (await j('GET', '/pos/shift', null, admin)).summary
ok('reopen takes the payment back out', after.expectedCash === before.expectedCash && after.revenue === before.revenue)
ok('history marks reopen as suspicious', (await j('GET', `/pos/receipts/${id}/history`, null, admin)).list.some((h) => h.action === 'receipt.reopen' && h.suspicious))
ok('pay again', (await j('POST', `/pos/receipts/${id}/pay`, { payments: [{ methodId: cash, amount: again.total }] }, admin)).s === 200)

await j('PATCH', '/settings', { ...s0, tableRedMinutes: s0.tableRedMinutes ?? 0 }, panel)
await j('PATCH', '/roles/' + adminRole.id, pick(adminRole), panel)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
