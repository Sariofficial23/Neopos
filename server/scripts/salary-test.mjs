// Зарплата: ставки сотрудника и отчёт за период.
// Запуск: node server/scripts/salary-test.mjs <логин> <пароль>   (после pos-flow-test)
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
// Рабочий день заведения начинается в 06:00 (настройка по умолчанию)
const today = new Date(Date.now() + 5 * 3600_000 - 6 * 3600_000).toISOString().slice(0, 10)
const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
const range = `from=${today}&to=${today}`

const { token: owner } = await j('POST', '/auth/login', { login, password })
const act = await j('POST', '/pos/activate', { login, password, name: 'Salary test' })
const roles = (await j('GET', '/roles', null, owner)).list
const sellerRole = roles.find((r) => !r.isOwner && r.terminalAccess && r.panelAccess) ?? roles.find((r) => !r.isOwner && r.terminalAccess)
const stamp = String(Date.now()).slice(-6)

// Новый сотрудник: оклад 3 000 000, 5% с продаж, 50% с обслуживания
let pin = ''
let u = null
for (let i = 0; i < 30 && !u?.id; i++) {
  pin = String(3000 + Math.floor(Math.random() * 6000))
  u = await j('POST', '/staff', { name: 'Salary Tester ' + stamp, roleId: sellerRole.id, pin, salaryFixed: 3_000_000, salarySalesBp: 500, salaryServiceBp: 5000 }, owner)
}
ok('employee created with rates', !!u?.id)
const listed = (await j('GET', '/staff', null, owner)).list.find((x) => x.id === u.id)
ok('rates are stored', listed?.salaryFixed === 3_000_000 && listed?.salarySalesBp === 500 && listed?.salaryServiceBp === 5000)
ok('bad percent -> 400', (await j('PATCH', '/staff/' + u.id, { name: 'Salary Tester ' + stamp, roleId: sellerRole.id, salarySalesBp: 20_000 }, owner)).s === 400)
// Правка без ставок (так делает касса) их не обнуляет
await j('PATCH', '/staff/' + u.id, { name: 'Salary Tester ' + stamp, roleId: sellerRole.id }, owner)
ok('editing without rates keeps them', (await j('GET', '/staff', null, owner)).list.find((x) => x.id === u.id)?.salarySalesBp === 500)

// Без продаж: только оклад за один день
const row = async (q = range) => (await j('GET', `/reports/salary?${q}`, null, owner)).rows?.find((x) => x.id === u.id)
let r0 = await row()
const dayPay = Math.round(3_000_000 / daysInMonth)
ok('one day of fixed salary, no sales yet', r0?.fixed === dayPay && r0?.fromSales === 0 && r0?.total === dayPay, JSON.stringify(r0))

// Продажа этим сотрудником за столом (с обслуживанием, если оно включено)
const tok = (await j('POST', '/pos/pin', { pin }, act.deviceToken)).token
const boot = await j('GET', '/pos/bootstrap', null, tok)
if (!boot.shift) {
  const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
  await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
}
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const dish = boot.products.find((p) => p.price > 0 && !p.byWeight)
const open = (await j('GET', '/pos/receipts', null, tok)).busyTables ?? []
const free = boot.halls.flatMap((h) => h.tables).find((t) => !open.includes(t.id))
let rc = await j('POST', '/pos/receipts', { tableId: free.id, guests: 2 }, tok)
rc = await j('POST', `/pos/receipts/${rc.id}/items`, { productId: dish.id, qty: 2000 }, tok)
const full = await j('GET', `/pos/receipts/${rc.id}`, null, tok)
const paid = await j('POST', `/pos/receipts/${rc.id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, tok)
ok('sale by the employee paid', paid.s === 200, `status=${paid.s} total=${full.total} service=${full.serviceAmount}`)

const r1 = await row()
const sales = full.total - full.serviceAmount
ok('report: receipts, sales without service, service', r1?.receipts === 1 && r1?.sales === sales && r1?.service === full.serviceAmount, JSON.stringify(r1))
ok('report: 5% of sales and 50% of service', r1?.fromSales === Math.round(sales * 0.05) && r1?.fromService === Math.round(full.serviceAmount * 0.5))
ok('report: total = fixed + sales part + service part', r1?.total === dayPay + r1.fromSales + r1.fromService)

// Целый месяц — полный оклад
const first = today.slice(0, 8) + '01'
const last = today.slice(0, 8) + String(daysInMonth).padStart(2, '0')
const rm = await row(`from=${first}&to=${last}`)
ok('whole month gives the whole fixed salary', rm?.fixed === 3_000_000, String(rm?.fixed))

// Доступ
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
ok('kassa-only employee cannot open the salary report', (await j('GET', `/reports/salary?${range}`, null, waiter)).s === 403)
ok('bad range -> 400', (await j('GET', '/reports/salary?from=2026-02-10&to=2026-02-01', null, owner)).s === 400)

// Уволенный без начислений из отчёта пропадает, с начислениями — остаётся
await j('DELETE', '/staff/' + u.id, null, owner)
ok('dismissed employee with earnings stays in the report', (await row())?.total > 0)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
