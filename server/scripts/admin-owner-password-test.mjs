// Админ-панель: в списке брендов виден логин и пароль владельца, заданный администратором.
// Запуск: node server/scripts/admin-owner-password-test.mjs <админ-логин> <админ-пароль>
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

const { token: admin } = await j('POST', '/admin/login', { login: adminLogin, password: adminPassword })
ok('admin logged in', !!admin)
const stamp = String(Date.now()).slice(-7)
const login = 'pwtest' + stamp
const first = 'first-pass-' + stamp
const created = await j('POST', '/admin/tenants', { venue: 'Password test ' + stamp, name: 'Owner ' + stamp, login, password: first }, admin)
ok('brand created', created.s === 200 && !!created.id, JSON.stringify(created))
const row = async () => (await j('GET', '/admin/tenants', null, admin)).list.find((b) => b.id === created.id)

let b = await row()
ok('list shows the login and the password set at creation', b?.owner?.login === login && b?.ownerPassword === first)
ok('revenue and kassa count are no longer in the list', b && !('revenue30' in b) && !('terminals' in b))
ok('the password really works', !!(await j('POST', '/auth/login', { login, password: first })).token)

// Новый пароль от администратора
const second = 'second-pass-' + stamp
ok('new password set by admin', (await j('POST', `/admin/tenants/${created.id}/reset-password`, { password: second }, admin)).s === 200)
b = await row()
ok('list shows the new password', b?.ownerPassword === second)
const owner = (await j('POST', '/auth/login', { login, password: second })).token
ok('old password no longer works, new one does', !!owner && !(await j('POST', '/auth/login', { login, password: first })).token)

// Сам владелец пароль не видит и чужой список не получает
ok('owner cannot open the admin list', (await j('GET', '/admin/tenants', null, owner)).s !== 200)
ok('owner session does not carry the password', !JSON.stringify(await j('GET', '/auth/me', null, owner)).includes(second))
// Главный терминал при обмене пароль не получает
const act = await j('POST', '/pos/activate', { login, password: second, name: 'Kassa' })
const pull = await j('GET', '/sync/pull', null, act.deviceToken)
ok('main terminal sync does not get the owner password', pull.s === 200 && pull.tenant?.ownerPassword == null && !JSON.stringify(pull).includes(second))

// Владелец сменил пароль сам — в админке он больше не показывается
const me = (await j('GET', '/staff', null, owner)).list.find((u) => u.login === login)
const own = 'own-pass-' + stamp
const ch = await j('PATCH', '/staff/' + me.id, { name: me.name, roleId: me.roleId, login, password: own }, owner)
ok('owner changed the password himself', ch.s === 200 && !!(await j('POST', '/auth/login', { login, password: own })).token)
b = await row()
ok('admin list no longer shows a stale password', b?.ownerPassword === null)
// Правка профиля без пароля ничего не стирает
await j('POST', `/admin/tenants/${created.id}/reset-password`, { password: second }, admin)
const owner2 = (await j('POST', '/auth/login', { login, password: second })).token
await j('PATCH', '/staff/' + me.id, { name: me.name + ' x', roleId: me.roleId, login }, owner2)
ok('editing the owner profile without a password keeps it', (await row())?.ownerPassword === second)

// Уборка: блокируем пробный бренд
await j('PATCH', '/admin/tenants/' + created.id, { blocked: true, note: 'test, can be removed' }, admin)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
