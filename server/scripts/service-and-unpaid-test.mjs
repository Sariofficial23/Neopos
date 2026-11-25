// Процент обслуживания в самом чеке и «Закрыть без оплаты».
// Запуск: node server/scripts/service-and-unpaid-test.mjs <логин> <пароль>   (после pos-flow-test)
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
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.discount'])] }, owner)
const act = await j('POST', '/pos/activate', { login, password, name: 'Service test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, admin)
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const takeaway = boot.saleTypes.find((x) => x.kind === 'takeaway')
const prod = await j('POST', '/products', { name: { uz: 'Svc item ' + Date.now(), ru: '' }, price: 10000 }, owner)

// ── Процент обслуживания ──
let r = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
r = await j('POST', `/pos/receipts/${r.id}/items`, { productId: prod.id, qty: 2000 }, admin)
const def = r.serviceBp
const svc = (percent, t = admin) => j('POST', `/pos/receipts/${r.id}/service`, { percent }, t)

ok('waiter without the right -> 403', (await svc(10, waiter)).s === 403)
ok('bad percent -> 400', (await svc(150)).s === 400 && (await svc(-1)).s === 400)

r = await svc(15)
ok('15%: 20 000 + 3 000', r.s === 200 && r.serviceBp === 1500 && r.serviceAmount === 3000 && r.total === 23000, `${r.serviceBp} ${r.total}`)
r = await j('POST', `/pos/receipts/${r.id}/discount`, { kind: 'percent', value: 10 }, admin)
ok('service is counted after the discount', r.serviceAmount === 2700 && r.total === 20700, String(r.total))
r = await j('POST', `/pos/receipts/${r.id}/discount`, { kind: 'none' }, admin)
r = await svc(0)
ok('0%: no service', r.serviceBp === 0 && r.serviceAmount === 0 && r.total === 20000)
r = await svc(7.5)
ok('fractional percent 7.5', r.serviceBp === 750 && r.serviceAmount === 1500)
r = await svc(null)
ok('null returns the usual percent', r.serviceBp === def, `${r.serviceBp} vs ${def}`)
const paidSvc = await svc(12)
r = paidSvc
const pay1 = await j('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: r.total }] }, admin)
ok('paid with the chosen percent', pay1.s === 200 && pay1.receipt.status === 'closed' && pay1.receipt.serviceAmount === 2400 && pay1.receipt.total === 22400)
ok('closed receipt: percent cannot be changed', (await svc(0)).s >= 400)
const hist = await j('GET', `/pos/receipts/${r.id}/history`, null, admin)
const hl = hist.list ?? hist.items ?? hist.history ?? []
const sv = hl.filter((h) => h.action === 'receipt.service')
ok('history keeps every change', sv.length >= 5 && sv.some((h) => h.data.from === 15 && h.data.to === 0 && h.suspicious), JSON.stringify(sv.map((h) => [h.data.from, h.data.to])))

// ── Закрыть без оплаты ──
const before = await j('GET', `/reports/summary?from=${today}&to=${today}`, null, owner)
let u = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
ok('empty receipt cannot be closed unpaid', (await j('POST', `/pos/receipts/${u.id}/close-unpaid`, null, admin)).s === 409)
u = await j('POST', `/pos/receipts/${u.id}/items`, { productId: prod.id, qty: 3000 }, admin)
u = await j('POST', `/pos/receipts/${u.id}/service`, { percent: 10 }, admin)
ok('before: total 33 000', u.total === 33000)
ok('waiter without the right -> 403', (await j('POST', `/pos/receipts/${u.id}/close-unpaid`, null, waiter)).s === 403)
const cu = await j('POST', `/pos/receipts/${u.id}/close-unpaid`, null, admin)
ok('closed with zero total', cu.s === 200 && cu.receipt.status === 'closed' && cu.receipt.total === 0 && cu.receipt.serviceAmount === 0 && cu.receipt.discountAmount === 30000, JSON.stringify({ s: cu.s, t: cu.receipt?.total }))
ok('items were sent to the kitchen', cu.receipt.items.every((i) => i.sentAt || i.sent))
ok('second close -> error', (await j('POST', `/pos/receipts/${u.id}/close-unpaid`, null, admin)).s >= 400)
ok('cannot be paid afterwards', (await j('POST', `/pos/receipts/${u.id}/pay`, { payments: [{ methodId: cash, amount: 1000 }] }, admin)).s >= 400)
const after = await j('GET', `/reports/summary?from=${today}&to=${today}`, null, owner)
ok('revenue did not change, receipt count +1', after.totals.revenue === before.totals.revenue && after.totals.receipts === before.totals.receipts + 1, `${before.totals.revenue} -> ${after.totals.revenue}; ${before.totals.receipts} -> ${after.totals.receipts}`)

// ── Отчёт «Подозрительные» ──
const sus = await j('GET', `/reports/suspicious?from=${today}&to=${today}`, null, owner)
const cUnpaid = sus.cases.find((c) => c.kind === 'unpaid' && c.receiptId === u.id)
ok('unpaid close is in the suspicious report with its sum', !!cUnpaid && cUnpaid.amount === 33000 && cUnpaid.weight === 4, JSON.stringify(cUnpaid ?? null))
const cSvc = sus.cases.filter((c) => c.kind === 'service_down' && c.receiptId === r.id)
ok('lowering the service percent is there too, raising is not', cSvc.length >= 1 && cSvc.every((c) => c.data.to < c.data.from) && cSvc.some((c) => c.amount === 3000), JSON.stringify(cSvc.map((c) => [c.data.from, c.data.to, c.amount])))
const dg = await j('GET', `/reports/digest?from=${today}&to=${today}&lang=ru`, null, owner)
ok('digest still builds', dg.s === 200 && dg.text.length > 100)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
