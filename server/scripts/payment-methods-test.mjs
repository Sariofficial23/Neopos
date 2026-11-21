// Способы оплаты из панели: по умолчанию только наличные и карта, касса видит только включённые.
// Запуск: node server/scripts/payment-methods-test.mjs <логин> <пароль>   (после pos-flow-test)
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
const act = await j('POST', '/pos/activate', { login, password, name: 'Pay test kassa' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token

const all = (await j('GET', '/payment-methods', null, panel)).list
const shown = (await j('GET', '/pos/bootstrap', null, admin)).paymentMethods
ok('kassa shows only cash and card', shown.length === 2 && shown.map((m) => m.kind).sort().join() === 'card,cash', shown.map((m) => m.name.uz).join(', '))
ok('Click/Payme kept but switched off', all.filter((m) => /Click|Payme/.test(m.name.uz)).every((m) => !m.active))
ok('kassa cannot read the settings list', (await j('GET', '/payment-methods', null, admin)).s === 403)

const uz = await j('POST', '/payment-methods', { name: { uz: 'Uzum', ru: '' }, kind: 'transfer' }, panel)
ok('add Uzum', uz.s === 200 && uz.name.ru === 'Uzum')
ok('kassa sees Uzum', (await j('GET', '/pos/bootstrap', null, admin)).paymentMethods.some((m) => m.id === uz.id))
ok('turn Uzum off', (await j('PATCH', '/payment-methods/' + uz.id, { ...uz, active: false }, panel)).active === false)
ok('kassa no longer sees Uzum', !(await j('GET', '/pos/bootstrap', null, admin)).paymentMethods.some((m) => m.id === uz.id))
ok('delete unused method', (await j('DELETE', '/payment-methods/' + uz.id, null, panel)).s === 200)
const cash = all.find((m) => m.kind === 'cash')
ok('used method cannot be deleted', (await j('DELETE', '/payment-methods/' + cash.id, null, panel)).error === 'payment_method_used')

// Нельзя выключить все способы
const card = all.find((m) => m.kind === 'card')
await j('PATCH', '/payment-methods/' + card.id, { ...card, active: false }, panel)
ok('cannot switch off the last one', (await j('PATCH', '/payment-methods/' + cash.id, { ...cash, active: false }, panel)).error === 'last_payment_method')
await j('PATCH', '/payment-methods/' + card.id, { ...card, active: true }, panel)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
