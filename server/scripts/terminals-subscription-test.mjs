// Терминалы с паролем (вход кассы по бренду) и абонентская плата.
// Запуск: node server/scripts/terminals-subscription-test.mjs <логин> <пароль> <админ-логин> <админ-пароль>
const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const [login, password, adminLogin, adminPassword] = process.argv.slice(2)
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

// ── Терминалы ──
const code = String(10000 + Math.floor(Math.random() * 89999))
ok('bad password format -> 400', (await j('POST', '/terminals', { name: 'T', password: '12' }, panel)).s === 400)
const t1 = await j('POST', '/terminals', { name: 'Test terminal', password: code }, panel)
ok('create terminal', t1.s === 200 && !!t1.id)
ok('same password twice -> 409', (await j('POST', '/terminals', { name: 'Dup', password: code }, panel)).error === 'terminal_password_taken')
const list = await j('GET', '/terminals', null, panel)
const mine = list.terminals?.find((t) => t.id === t1.id)
ok('list shows brand, password, offline', list.brand === login && mine?.password === code && mine.online === false, `brand=${list.brand}`)

ok('wrong terminal password -> 401', (await j('POST', '/pos/activate', { brand: login, password: '00000000' })).error === 'bad_terminal')
ok('wrong brand -> same 401', (await j('POST', '/pos/activate', { brand: 'no-such-brand', password: code })).error === 'bad_terminal')
const act = await j('POST', '/pos/activate', { brand: login.toUpperCase(), password: code })
ok('activate by brand + terminal password', act.s === 200 && !!act.deviceToken && act.terminal === 'Test terminal', act.venue)
ok('PIN login works on that terminal', !!(await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token)
ok('ping', (await j('POST', '/pos/ping', null, act.deviceToken)).ok === true)
ok('ping needs a device token', (await j('POST', '/pos/ping', null, panel)).s === 401)
ok('terminal is online now', (await j('GET', '/terminals', null, panel)).terminals.find((t) => t.id === t1.id).online === true)

await j('PATCH', '/terminals/' + t1.id, { name: 'Test terminal', password: code, active: false }, panel)
ok('disabled terminal: activation refused', (await j('POST', '/pos/activate', { brand: login, password: code })).error === 'terminal_disabled')
ok('disabled terminal: PIN refused', (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).s === 401)
ok('disabled terminal: ping tells kassa to leave', (await j('POST', '/pos/ping', null, act.deviceToken)).error === 'device_not_activated')
ok('old activation by owner login still works', !!(await j('POST', '/pos/activate', { login, password, name: 'Old way' })).deviceToken)
ok('delete terminal', (await j('DELETE', '/terminals/' + t1.id, null, panel)).ok === true)
ok('deleted terminal: ping refused', (await j('POST', '/pos/ping', null, act.deviceToken)).s === 401)

// ── Абонентская плата ──
const { token: admin } = await j('POST', '/admin/login', { login: adminLogin, password: adminPassword })
const tenants = (await j('GET', '/admin/tenants', null, admin)).list
const tid = tenants.find((t) => t.owner?.login === login).id
const base = `/admin/tenants/${tid}/subscription`
ok('panel token cannot edit subscription', (await j('PATCH', base, { tariff: 'X', monthlyFee: 1, nextPaymentAt: null }, panel)).s === 401)
const due = new Date(Date.now() - 86_400_000).toISOString()
const set = await j('PATCH', base, { tariff: 'Standard', monthlyFee: 500000, nextPaymentAt: due }, admin)
ok('admin sets tariff; overdue flagged', set.tariff === 'Standard' && set.monthlyFee === 500000 && set.overdue === true)
const paid = await j('POST', base + '/payments', { amount: 500000, method: 'Karta', months: 1 }, admin)
const next = new Date(paid.nextPaymentAt).getTime()
ok('payment recorded and next date moved ~1 month ahead', paid.payments?.[0]?.amount === 500000 && paid.overdue === false && next - Date.now() > 27 * 86_400_000 && next - Date.now() < 32 * 86_400_000)
const mineSub = await j('GET', '/subscription', null, panel)
ok('owner sees tariff and history in the panel', mineSub.monthlyFee === 500000 && mineSub.payments.some((p) => p.method === 'Karta'))
const del = await j('DELETE', `${base}/payments/${paid.payments[0].id}`, null, admin)
ok('admin deletes a payment record', !del.payments.some((p) => p.id === paid.payments[0].id))
await j('PATCH', base, { tariff: 'Standard', monthlyFee: 0, nextPaymentAt: null }, admin)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
