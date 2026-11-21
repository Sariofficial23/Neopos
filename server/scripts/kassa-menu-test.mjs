// Правка меню с кассы: только с правом «menu.edit»; панель работает как раньше.
// Запуск: node server/scripts/kassa-menu-test.mjs <логин> <пароль>   (после pos-flow-test)
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
// Временно даём администратору правку меню
await j('PATCH', '/roles/' + adminRole.id, { ...pick(adminRole), permissions: [...new Set([...adminRole.permissions, 'menu.edit'])] }, panel)

const act = await j('POST', '/pos/activate', { login, password, name: 'Menu test kassa' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token

ok('waiter cannot read full menu', (await j('GET', '/products', null, waiter)).s === 403)
ok('waiter cannot add category', (await j('POST', '/categories', { name: { uz: 'X', ru: '' } }, waiter)).s === 403)
ok('device token cannot edit', (await j('POST', '/categories', { name: { uz: 'X', ru: '' } }, act.deviceToken)).s === 401)
ok('admin reads menu from kassa', (await j('GET', '/products', null, admin)).s === 200)

const c = await j('POST', '/categories', { name: { uz: 'Kassa kat', ru: '' }, color: '#22c55e' }, admin)
ok('admin adds category', c.s === 200 && c.name.ru === 'Kassa kat')
const p = await j('POST', '/products', { name: { uz: '', ru: 'Kassa taom' }, price: 12000, categoryId: c.id }, admin)
ok('admin adds product', p.s === 200 && p.price === 12000)
const full = (await j('GET', '/products', null, admin)).list.find((x) => x.id === p.id)
ok('edit keeps other fields', (await j('PATCH', '/products/' + p.id, { ...full, cost: 5000 }, panel)).s === 200)
const e = await j('PATCH', '/products/' + p.id, { ...full, cost: 5000, price: 15000, stopped: true }, admin)
ok('admin edits price and stop-list', e.s === 200 && e.price === 15000 && e.stopped === true && e.cost === 5000)
const boot = await j('GET', '/pos/bootstrap', null, admin)
ok('bootstrap shows the new dish', boot.products.some((x) => x.id === p.id && x.price === 15000))
ok('category with dish cannot be deleted', (await j('DELETE', '/categories/' + c.id, null, admin)).s === 409)
ok('admin deletes product', (await j('DELETE', '/products/' + p.id, null, admin)).s === 200)
ok('admin deletes category', (await j('DELETE', '/categories/' + c.id, null, admin)).s === 200)
ok('panel still reads menu', (await j('GET', '/categories', null, panel)).s === 200)

await j('PATCH', '/roles/' + adminRole.id, pick(adminRole), panel)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
