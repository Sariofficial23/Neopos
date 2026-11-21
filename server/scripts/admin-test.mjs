// Проверка админ-панели платформы. Запуск: node server/scripts/admin-test.mjs <логин-админа> <пароль-админа>
// (на сервере разработки данные в server/data/admin-credentials.txt)
import { randomBytes } from 'node:crypto'

const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const [adminLogin, adminPassword] = process.argv.slice(2)
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

ok('admin bad password -> 401', (await j('POST', '/admin/login', { login: adminLogin, password: 'wrong-wrong' })).s === 401)
const A = (await j('POST', '/admin/login', { login: adminLogin, password: adminPassword })).token
ok('admin login', !!A)
ok('no token -> 401', (await j('GET', '/admin/tenants')).s === 401)

// Создание бренда администратором
const login = 'br' + randomBytes(4).toString('hex')
const password = randomBytes(9).toString('base64url')
const created = await j('POST', '/admin/tenants', { venue: 'Brand Test', name: 'Owner B', login, password, lang: 'ru', note: '+998 90 000 00 00' }, A)
ok('create brand', created.s === 200 && !!created.id)
ok('duplicate login -> 409', (await j('POST', '/admin/tenants', { venue: 'Other brand', name: 'Other owner', login, password }, A)).s === 409)
let list = (await j('GET', '/admin/tenants', null, A)).list
let row = list.find((t) => t.id === created.id)
ok('brand in list with owner', !!row && row.owner?.login === login && row.staff === 1 && row.note === '+998 90 000 00 00' && row.blocked === false)

// Владелец бренда входит, токен админа не работает в панели бренда и наоборот
const owner = await j('POST', '/auth/login', { login, password })
ok('owner can log in', !!owner.token)
ok('admin token rejected by brand routes', (await j('GET', '/staff', null, A)).s === 401)
ok('brand token rejected by admin routes', (await j('GET', '/admin/tenants', null, owner.token)).s === 401)
const dev = await j('POST', '/pos/activate', { login, password, name: 'k' })
ok('device activation works', !!dev.deviceToken)
ok('admin token rejected by pos pin', (await j('POST', '/pos/pin', { pin: '1234' }, A)).s === 401)

// Блокировка
ok('block brand', (await j('PATCH', `/admin/tenants/${created.id}`, { blocked: true }, A)).s === 200)
ok('blocked: existing token stops working', (await j('GET', '/auth/me', null, owner.token)).error === 'venue_blocked')
ok('blocked: login refused', (await j('POST', '/auth/login', { login, password })).error === 'venue_blocked')
ok('blocked: device activation refused', (await j('POST', '/pos/activate', { login, password, name: 'k2' })).error === 'venue_blocked')
ok('blocked: pin refused', (await j('POST', '/pos/pin', { pin: '1234' }, dev.deviceToken)).error === 'venue_blocked')
list = (await j('GET', '/admin/tenants', null, A)).list
ok('list shows blocked', list.find((t) => t.id === created.id)?.blocked === true)
await j('PATCH', `/admin/tenants/${created.id}`, { blocked: false }, A)
ok('unblocked: login works again', !!(await j('POST', '/auth/login', { login, password })).token)

// Сброс пароля владельцу
const newPassword = randomBytes(9).toString('base64url')
const reset = await j('POST', `/admin/tenants/${created.id}/reset-password`, { password: newPassword }, A)
ok('reset password', reset.s === 200 && reset.login === login)
ok('old password no longer works', (await j('POST', '/auth/login', { login, password })).s === 401)
ok('new password works', !!(await j('POST', '/auth/login', { login, password: newPassword })).token)
ok('short password rejected', (await j('POST', `/admin/tenants/${created.id}/reset-password`, { password: '123' }, A)).s === 400)

// Регистрация: закрыть и открыть
ok('close registration', (await j('PATCH', '/admin/settings', { allowRegister: false }, A)).allowRegister === false)
ok('public meta says closed', (await j('GET', '/meta/public')).allowRegister === false)
ok('register refused when closed', (await j('POST', '/auth/register', { venue: 'Z', name: 'Z Z', login: login + 'z', password })).error === 'registration_closed')
ok('reopen registration', (await j('PATCH', '/admin/settings', { allowRegister: true }, A)).allowRegister === true)

// Переименование
await j('PATCH', `/admin/tenants/${created.id}`, { name: 'Brand Renamed' }, A)
ok('rename brand', (await j('GET', '/auth/me', null, (await j('POST', '/auth/login', { login, password: newPassword })).token)).tenant?.name === 'Brand Renamed')

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
