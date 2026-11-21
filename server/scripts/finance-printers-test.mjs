// Проверка кассовых операций с категориями и сетевых принтеров на сервере разработки.
// Запуск: node server/scripts/finance-printers-test.mjs <логин> <пароль>   (демо-заведение)
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
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
let failed = 0
const ok = (name, cond, extra = '') => {
  if (!cond) failed++
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''))
}

const { token: panel } = await j('POST', '/auth/login', { login, password })
// Права «настройки» нужны для принтеров: временно даём их роли администратора
const roles = (await j('GET', '/roles', null, panel)).list
const adminRole = roles.find((r) => !r.isOwner && r.panelAccess)
const pick = (r) => ({ name: r.name, panelAccess: r.panelAccess, terminalAccess: r.terminalAccess, permissions: r.permissions })
await j('PATCH', '/roles/' + adminRole.id, { ...pick(adminRole), permissions: [...new Set([...adminRole.permissions, 'settings.edit'])] }, panel)
const act = await j('POST', '/pos/activate', { login, password, name: 'Finance test kassa' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token
ok('pin logins (run pos-flow-test first)', !!admin && !!waiter)

// Категории
const cats = await j('GET', '/pos/finance-categories', null, admin)
const exp = cats.list.filter((c) => c.kind === 'expense')
const inc = cats.list.filter((c) => c.kind === 'income')
ok('default categories seeded', exp.length >= 10 && inc.length >= 3, `expense=${exp.length} income=${inc.length}`)
ok('subcategories exist', exp.some((c) => c.parentId))
ok('waiter cannot edit categories', (await j('POST', '/finance-categories', { kind: 'expense', name: 'X' }, waiter)).s >= 401)
const nc = await j('POST', '/finance-categories', { kind: 'expense', name: 'Test cat' }, panel)
ok('panel creates category', nc.s === 200 && !!nc.id)
const sub = await j('POST', '/finance-categories', { kind: 'expense', name: 'Test sub', parentId: nc.id }, panel)
ok('panel creates subcategory', sub.s === 200)
ok('rename', (await j('PATCH', '/finance-categories/' + nc.id, { kind: 'expense', name: 'Test cat 2', parentId: null, sort: 0 }, panel)).s === 200)

// Смена и операции
const boot = await j('GET', '/pos/bootstrap', null, admin)
ok('bootstrap has printers array', Array.isArray(boot.printers))
if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 100000 }, admin)
const expense = exp.find((c) => c.parentId) ?? exp[0]
ok('expense without category -> 400', (await j('POST', '/pos/shift/cash', { type: 'expense', amount: 1000 }, admin)).s === 400)
ok('expense with income category -> 400', (await j('POST', '/pos/shift/cash', { type: 'expense', amount: 1000, categoryId: inc[0].id }, admin)).s === 400)
ok('too much cash out -> not_enough_cash', (await j('POST', '/pos/shift/cash', { type: 'expense', amount: 999_000_000, categoryId: expense.id }, admin)).error === 'not_enough_cash')
const before = await j('GET', '/pos/shift', null, admin)
ok('expense', (await j('POST', '/pos/shift/cash', { type: 'expense', amount: 15000, categoryId: expense.id, note: 'bazar' }, admin)).s === 200)
ok('income', (await j('POST', '/pos/shift/cash', { type: 'income', amount: 20000, categoryId: inc[0].id }, admin)).s === 200)
ok('collection without category', (await j('POST', '/pos/shift/cash', { type: 'collection', amount: 5000 }, admin)).s === 200)
const after = await j('GET', '/pos/shift', null, admin)
const exp0 = before.summary?.expectedCash ?? before.expectedCash
const exp1 = after.summary?.expectedCash ?? after.expectedCash
ok('expected cash moves by +20000-15000-5000', exp1 === exp0, `${exp0} -> ${exp1}`)
const mv = (after.summary ?? after).movements ?? []
ok('movement carries category name', mv.some((m) => m.type === 'expense' && m.category === expense.name))

// Отчёт панели
const rep = await j('GET', '/reports/summary?from=' + day(-1) + '&to=' + day(1), null, panel)
ok('report cash block', rep.cash && rep.cash.expense >= 15000 && rep.cash.byCategory.length > 0, JSON.stringify(rep.cash ?? rep).slice(0, 120))

// Принтеры
ok('waiter cannot add printer', (await j('POST', '/pos/printers', { name: 'K', ip: '192.168.1.50' }, waiter)).s === 403)
ok('bad ip -> 400', (await j('POST', '/pos/printers', { name: 'K', ip: '999.1.1.1' }, admin)).s === 400)
const dep = boot.departments?.[0]?.id
const pr = await j('POST', '/pos/printers', { name: 'Kitchen', ip: '192.168.1.50', port: 9100, width: 80, departmentIds: dep ? [dep] : [], receipts: false, active: true }, admin)
ok('add printer', pr.s === 200 && !!pr.id, pr.error ?? '')
ok('edit printer', (await j('PATCH', '/pos/printers/' + pr.id, { name: 'Kitchen 2', ip: '192.168.1.51', port: 9100, width: 58, departmentIds: [], receipts: true, active: true }, admin)).s === 200)
const boot2 = await j('GET', '/pos/bootstrap', null, admin)
ok('bootstrap lists printer', boot2.printers.some((p) => p.name === 'Kitchen 2' && p.ip === '192.168.1.51'))
ok('delete printer', (await j('DELETE', '/pos/printers/' + pr.id, null, admin)).s === 200)
ok('delete category with subs', (await j('DELETE', '/finance-categories/' + nc.id, null, panel)).s === 200)
const cats2 = await j('GET', '/pos/finance-categories', null, admin)
ok('subcategory removed too', !cats2.list.some((c) => c.id === sub.id))

await j('PATCH', '/roles/' + adminRole.id, pick(adminRole), panel)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
