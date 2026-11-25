// Сотрудники и должности: ПИН-код виден владельцу, быстрые флажки должности.
// Запуск: node server/scripts/staff-pin-test.mjs <логин> <пароль>
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
const act = await j('POST', '/pos/activate', { login, password, name: 'Staff test' })
const roles = (await j('GET', '/roles', null, owner)).list
const stamp = String(Date.now()).slice(-6)

// Должность без доступа к панели и новый сотрудник с ПИН-кодом
const role = await j('POST', '/roles', { name: 'Test role ' + stamp, panelAccess: false, terminalAccess: true, permissions: [] }, owner)
// Свободный ПИН-код: перебираем, пока не примут
let pin = ''
let created = null
for (let i = 0; i < 30 && !created?.id; i++) {
  pin = String(3000 + Math.floor(Math.random() * 6000))
  created = await j('POST', '/staff', { name: 'Pin Tester ' + stamp, roleId: role.id, pin }, owner)
}
ok('staff created with a PIN', !!created?.id, JSON.stringify(created))
const row = () => j('GET', '/staff', null, owner).then((r) => r.list.find((x) => x.id === created.id))
ok('owner sees the PIN in the list', (await row())?.pin === pin && (await row())?.hasPin === true)

// Смена ПИН-кода
let pin2 = ''
let patched = { s: 0 }
for (let i = 0; i < 30 && patched.s !== 200; i++) {
  pin2 = String(3000 + Math.floor(Math.random() * 6000))
  if (pin2 !== pin) patched = await j('PATCH', '/staff/' + created.id, { name: 'Pin Tester ' + stamp, roleId: role.id, pin: pin2 }, owner)
}
ok('PIN changed and shown', patched.s === 200 && (await row())?.pin === pin2)
ok('old PIN no longer works, new one does', (await j('POST', '/pos/pin', { pin }, act.deviceToken)).s !== 200 && !!(await j('POST', '/pos/pin', { pin: pin2 }, act.deviceToken)).token)
// Правка без ПИН-кода не стирает его
await j('PATCH', '/staff/' + created.id, { name: 'Pin Tester ' + stamp + ' x', roleId: role.id }, owner)
ok('editing without a PIN keeps it', (await row())?.pin === pin2)

// Сотрудник с правом только смотреть — ПИН-коды не видит
const viewerRole = await j('POST', '/roles', { name: 'Viewer ' + stamp, panelAccess: true, terminalAccess: false, permissions: ['staff.view'] }, owner)
const vLogin = 'viewer' + stamp
const vPass = 'viewer-pass-' + stamp
await j('POST', '/staff', { name: 'Viewer ' + stamp, roleId: viewerRole.id, login: vLogin, password: vPass }, owner)
const viewer = (await j('POST', '/auth/login', { login: vLogin, password: vPass })).token
const seen = await j('GET', '/staff', null, viewer)
ok('viewer without staff.edit gets no PINs', seen.s === 200 && seen.list.every((x) => x.pin == null) && seen.list.find((x) => x.id === created.id)?.hasPin === true)

// Старый сотрудник (ПИН задан до этой версии) — ПИН появляется после входа на кассе
const before = (await j('GET', '/staff', null, owner)).list
const logged = await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)
const waiterId = JSON.parse(Buffer.from(logged.token.split('.')[1], 'base64url').toString()).sub
ok('PIN of an existing employee appears after a kassa login', (await j('GET', '/staff', null, owner)).list.find((x) => x.id === waiterId)?.pin === '1111', `before=${before.find((x) => x.id === waiterId)?.pin}`)

// Быстрые флажки должности
const q = await j('PATCH', '/roles/' + role.id, { name: role.name, panelAccess: true, terminalAccess: false, permissions: [] }, owner)
ok('role flags switch', q.s === 200 && q.panelAccess === true && q.terminalAccess === false)
ok('kassa login refused when the role lost terminal access', (await j('POST', '/pos/pin', { pin: pin2 }, act.deviceToken)).s !== 200)
const ownerRole = roles.find((r) => r.isOwner)
const o = await j('PATCH', '/roles/' + ownerRole.id, { name: ownerRole.name, panelAccess: false, terminalAccess: false, permissions: [] }, owner)
ok('owner role cannot be restricted', o.s === 200 && (await j('GET', '/roles', null, owner)).s === 200)

// Удаление стирает ПИН-код
await j('DELETE', '/staff/' + created.id, null, owner)
ok('deleted employee is gone and the PIN is free again', !(await j('GET', '/staff', null, owner)).list.some((x) => x.id === created.id))
const vId = (await j('GET', '/staff', null, owner)).list.find((x) => x.login === vLogin)?.id
if (vId) await j('DELETE', '/staff/' + vId, null, owner)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
