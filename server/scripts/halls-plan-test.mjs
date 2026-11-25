// Залы и столы: процент обслуживания зала, порядок залов, план (расстановка), «Очистить столы».
// Запуск: node server/scripts/halls-plan-test.mjs <логин> <пароль>   (после pos-flow-test)
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
// Администратору кассы нужно право на перенос стола
const roleList = (await j('GET', '/roles', null, owner)).list
const adminRole = roleList.find((x) => !x.isOwner && x.panelAccess && x.terminalAccess)
await j('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: adminRole.panelAccess, terminalAccess: adminRole.terminalAccess, permissions: [...new Set([...adminRole.permissions, 'receipt.transfer'])] }, owner)
const act = await j('POST', '/pos/activate', { login, password, name: 'Halls test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
const stamp = String(Date.now()).slice(-6)
const halls = () => j('GET', '/halls', null, owner).then((r) => r.list)

// Зал с платой за обслуживание 15%
const hall = await j('POST', '/halls', { name: 'Plan ' + stamp, servicePercent: 15 }, owner)
ok('hall created with service 15%, placed last', hall.s === 200 && hall.serviceBp === 1500 && (await halls()).at(-1).id === hall.id, JSON.stringify(hall).slice(0, 120))

// Десять столов сразу — встают на план рядами, не накладываясь
const bulk = await j('POST', '/tables/bulk', { hallId: hall.id, from: 1, to: 10, seats: 4 }, owner)
const cells = new Set(bulk.list.map((t) => `${t.x}:${t.y}`))
ok('10 tables created on the plan without overlap', bulk.s === 200 && bulk.list.length === 10 && cells.size === 10 && bulk.list.every((t) => t.w === 2 && t.h === 2), [...cells].join(' '))
ok('ninth table starts the second row', bulk.list.find((t) => t.name === '9')?.y === 3 && bulk.list.find((t) => t.name === '9')?.x === 0)
const one = await j('POST', '/tables', { hallId: hall.id, name: '11', seats: 2 }, owner)
ok('a single new table takes the next free place', one.s === 200 && !cells.has(`${one.x}:${one.y}`), `${one.x}:${one.y}`)

// План: сдвинуть, сделать круглым и большим
const t1 = bulk.list[0]
const lay = await j('PUT', `/halls/${hall.id}/layout`, { tables: [{ id: t1.id, x: 20, y: 30, w: 4, h: 2, shape: 'round' }] }, owner)
const saved = (await halls()).find((h) => h.id === hall.id).tables.find((t) => t.id === t1.id)
ok('layout saved', lay.s === 200 && saved.x === 20 && saved.y === 30 && saved.w === 4 && saved.shape === 'round', JSON.stringify(saved))
ok('out of the grid -> 400', (await j('PUT', `/halls/${hall.id}/layout`, { tables: [{ id: t1.id, x: 99, y: 0, w: 2, h: 2, shape: 'rect' }] }, owner)).s === 400)
ok('waiter cannot change the plan', (await j('PUT', `/halls/${hall.id}/layout`, { tables: [] }, waiter)).s === 403)
// Чужой стол (из другого зала) этим запросом не двигается
const other = (await halls()).find((h) => h.id !== hall.id && h.tables.length)
if (other) {
  const foreign = other.tables[0]
  await j('PUT', `/halls/${hall.id}/layout`, { tables: [{ id: foreign.id, x: 5, y: 5, w: 2, h: 2, shape: 'rect' }] }, owner)
  const after = (await halls()).find((h) => h.id === other.id).tables.find((t) => t.id === foreign.id)
  ok('a table of another hall is not moved', after.x === foreign.x && after.y === foreign.y)
}
const boot = await j('GET', '/pos/bootstrap', null, admin)
const bt = boot.halls.find((h) => h.id === hall.id)?.tables.find((t) => t.id === t1.id)
ok('kassa gets the plan', bt?.x === 20 && bt?.y === 30 && bt?.shape === 'round' && bt?.serviceBp === 1500, JSON.stringify(bt))

// Процент зала попадает в чек; процент стола важнее
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
const dish = boot.products.find((p) => p.price > 0 && !p.byWeight)
let rc = await j('POST', '/pos/receipts', { tableId: t1.id, guests: 1 }, admin)
rc = await j('POST', `/pos/receipts/${rc.id}/items`, { productId: dish.id, qty: 1000 }, admin)
ok('receipt takes the hall service 15%', rc.serviceBp === 1500 && rc.serviceAmount === Math.round(dish.price * 0.15), `bp=${rc.serviceBp} amount=${rc.serviceAmount}`)
const t2 = bulk.list[1]
await j('PATCH', '/tables/' + t2.id, { hallId: hall.id, name: t2.name, seats: 4, servicePercent: 5 }, owner)
const rc2 = await j('POST', '/pos/receipts', { tableId: t2.id, guests: 1 }, admin)
ok('table service 5% wins over the hall', rc2.serviceBp === 500, String(rc2.serviceBp))
// Перенос на стол без своего процента — берётся процент зала
const moved = await j('POST', `/pos/receipts/${rc2.id}/move`, { tableId: bulk.list[2].id }, admin)
ok('moving to a table without its own percent takes the hall percent', moved.serviceBp === 1500, JSON.stringify(moved).slice(0, 200))

// «Очистить столы» нельзя при открытых чеках
ok('clear refused while receipts are open', (await j('DELETE', `/halls/${hall.id}/tables`, null, owner)).s === 409)
await j('DELETE', `/pos/receipts/${rc2.id}`, null, admin)
// чек с позицией отменить нельзя — оплачиваем
const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
const full = await j('GET', `/pos/receipts/${rc.id}`, null, admin)
await j('POST', `/pos/receipts/${rc.id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, admin)

// Зал «по умолчанию» (без процента) и порядок залов
const upd = await j('PATCH', '/halls/' + hall.id, { name: 'Plan ' + stamp, servicePercent: null }, owner)
ok('hall service back to default', upd.s === 200 && upd.serviceBp === null)
const keep = await j('PATCH', '/halls/' + hall.id, { name: 'Plan ' + stamp + ' x' }, owner)
ok('renaming without a percent keeps percent and order', keep.serviceBp === null && (await halls()).at(-1).id === hall.id)
const ids = (await halls()).map((h) => h.id)
const reordered = [ids.at(-1), ...ids.slice(0, -1)]
const ord = await j('POST', '/halls/order', { ids: reordered }, owner)
ok('hall order saved, kassa follows it', ord.s === 200 && (await halls())[0].id === hall.id && (await j('GET', '/pos/bootstrap', null, admin)).halls[0].id === hall.id)
await j('POST', '/halls/order', { ids }, owner)

const cleared = await j('DELETE', `/halls/${hall.id}/tables`, null, owner)
ok('clear tables', cleared.s === 200 && cleared.removed === 11 && (await halls()).find((h) => h.id === hall.id).tables.length === 0, JSON.stringify(cleared))
ok('waiter cannot clear', (await j('DELETE', `/halls/${hall.id}/tables`, null, waiter)).s === 403)
await j('DELETE', '/halls/' + hall.id, null, owner)
ok('hall removed', !(await halls()).some((h) => h.id === hall.id))

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
