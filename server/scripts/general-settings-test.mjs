// Общие настройки: начало рабочего дня, автовыход с кассы, причины удаления позиции.
// Запуск: node server/scripts/general-settings-test.mjs <логин> <пароль>   (после pos-flow-test)
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
const local = new Date(Date.now() + 5 * 3600_000)
const day = (d) => d.toISOString().slice(0, 10)
const today = day(local)
const yesterday = day(new Date(local.getTime() - 86_400_000))
const hour = local.getUTCHours()

const { token: owner } = await j('POST', '/auth/login', { login, password })
const act = await j('POST', '/pos/activate', { login, password, name: 'Settings test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token

const { s: _s, ...initial } = await j('GET', '/settings', null, owner)
ok('settings have day start and auto-logout', Number.isInteger(initial.dayStartHour) && Number.isInteger(initial.autoLogoutMinutes), `${initial.dayStartHour} / ${initial.autoLogoutMinutes}`)
const set = async (patch) => j('PATCH', '/settings', { ...initial, ...patch }, owner)

try {
  // Сохранение и передача на кассу и в панель
  const a = await set({ dayStartHour: 0, autoLogoutMinutes: 0 })
  ok('saved', a.s === 200 && a.dayStartHour === 0 && a.autoLogoutMinutes === 0)
  let boot = await j('GET', '/pos/bootstrap', null, admin)
  ok('kassa gets both settings', boot.dayStartHour === 0 && boot.autoLogoutMinutes === 0)
  ok('panel session gets the day start', (await j('GET', '/auth/me', null, owner)).tenant?.dayStartHour === 0)
  // Старая версия панели не присылает новые поля — значения не должны сброситься
  const { dayStartHour: _d, autoLogoutMinutes: _a, ...oldBody } = initial
  await j('PATCH', '/settings', oldBody, owner)
  const kept = await j('GET', '/settings', null, owner)
  ok('old panel version does not reset them', kept.dayStartHour === 0 && kept.autoLogoutMinutes === 0)
  ok('bad values -> 400', (await set({ dayStartHour: 20 })).s === 400 && (await set({ autoLogoutMinutes: -1 })).s === 400)
  ok('waiter cannot change settings', (await j('PATCH', '/settings', initial, waiter)).s === 403)

  // Продажа сейчас: к какому рабочему дню она относится
  if (!boot.shift) await j('POST', '/pos/shift/open', { openingCash: 0 }, admin)
  const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
  const takeaway = boot.saleTypes.find((x) => x.kind === 'takeaway')
  const dish = boot.products.find((p) => p.price > 0 && !p.byWeight)
  let rc = await j('POST', '/pos/receipts', { saleTypeId: takeaway.id }, admin)
  rc = await j('POST', `/pos/receipts/${rc.id}/items`, { productId: dish.id, qty: 1000 }, admin)
  await j('POST', `/pos/receipts/${rc.id}/pay`, { payments: [{ methodId: cash, amount: rc.total }] }, admin)
  const has = async (d) => (await j('GET', `/receipts?from=${d}&to=${d}&status=closed&number=${rc.number}`, null, owner)).rows?.some((x) => x.id === rc.id)
  ok('day start 00:00: a sale now belongs to today', (await has(today)) && !(await has(yesterday)))
  if (hour < 12) {
    await set({ dayStartHour: hour + 1 })
    ok(`day start ${hour + 1}:00 (later than now): the sale belongs to yesterday`, (await has(yesterday)) && !(await has(today)))
    const sum = await j('GET', `/reports/summary?from=${yesterday}&to=${yesterday}`, null, owner)
    ok('summary groups it under yesterday', sum.byDay?.some((d) => d.day === yesterday) && !sum.byDay?.some((d) => d.day === today), JSON.stringify(sum.byDay))
  } else {
    console.log('SKIP  later-than-now day start (it is after 12:00, the setting allows 00–12)')
  }

  // Причины удаления
  const before = (await j('GET', '/reasons', null, owner)).list
  ok('reasons listed', before.length > 0 && before.every((r) => r.name?.uz))
  const added = await j('POST', '/reasons', { name: { uz: 'Test sabab ' + Date.now(), ru: '' } }, owner)
  ok('reason added (second language filled in)', added.s === 200 && added.active === true && added.name.ru === added.name.uz)
  ok('empty name -> 400', (await j('POST', '/reasons', { name: { uz: '', ru: '' } }, owner)).s === 400)
  boot = await j('GET', '/pos/bootstrap', null, admin)
  ok('kassa sees the new reason', boot.reasons.some((r) => r.id === added.id))
  const off = await j('PATCH', '/reasons/' + added.id, { name: { uz: 'Renamed', ru: 'Переименована' }, active: false }, owner)
  ok('reason renamed and switched off', off.s === 200 && off.active === false && off.name.ru === 'Переименована')
  ok('kassa no longer shows it', !(await j('GET', '/pos/bootstrap', null, admin)).reasons.some((r) => r.id === added.id))
  ok('waiter cannot edit reasons', (await j('POST', '/reasons', { name: { uz: 'x', ru: '' } }, waiter)).s === 403)
  // Последнюю включённую причину выключить нельзя
  const live = (await j('GET', '/reasons', null, owner)).list.filter((r) => r.active)
  for (const r of live.slice(1)) await j('PATCH', '/reasons/' + r.id, { name: r.name, active: false }, owner)
  ok('the last active reason cannot be switched off', (await j('PATCH', '/reasons/' + live[0].id, { name: live[0].name, active: false }, owner)).error === 'last_reason')
  for (const r of live.slice(1)) await j('PATCH', '/reasons/' + r.id, { name: r.name, active: true }, owner)
} finally {
  // Возвращаем настройки заведения как были
  const back = await j('PATCH', '/settings', initial, owner)
  ok('settings restored', back.dayStartHour === initial.dayStartHour && back.autoLogoutMinutes === initial.autoLogoutMinutes)
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
