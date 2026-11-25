// ИИ-сводка: проверяем набор цифр, который уходит модели, и отказы. Саму модель тест не вызывает
// (это стоит денег) — если на сервере задан ключ, шаг с настоящей сводкой пропускается.
// Запуск: node server/scripts/ai-summary-test.mjs <логин> <пароль>   (после pos-flow-test)
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
const today = new Date(Date.now() + 5 * 3600_000 - 6 * 3600_000).toISOString().slice(0, 10)

const { token: owner } = await j('POST', '/auth/login', { login, password })
const act = await j('POST', '/pos/activate', { login, password, name: 'AI test' })
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token

const status = await j('GET', '/reports/ai-summary/status', null, owner)
ok('status tells whether the key is set', status.s === 200 && typeof status.configured === 'boolean', String(status.configured))

// Набор цифр без обращения к модели
const dry = await j('POST', '/reports/ai-summary', { from: today, to: today, dry: true }, owner)
const f = dry.facts
ok('dry run returns the facts', dry.s === 200 && !!f)
const sum = await j('GET', `/reports/summary?from=${today}&to=${today}`, null, owner)
ok('totals are the same as in the revenue report', f.totals.revenue === sum.totals.revenue && f.totals.receipts === sum.totals.receipts && f.totals.profit === sum.totals.profit, `${f.totals.revenue} vs ${sum.totals.revenue}`)
const sus = await j('GET', `/reports/suspicious?from=${today}&to=${today}`, null, owner)
ok('suspicious part is the same as in the suspicious report', f.suspicious.totals.high === sus.totals.high && f.suspicious.employees.length === Math.min(8, sus.byUser.length) && (f.suspicious.employees[0]?.name ?? null) === (sus.byUser[0]?.name ?? null))
ok('period and venue are included', f.period.from === today && f.period.days === 1 && typeof f.venue === 'string' && f.venue.length > 0)
ok('product quantities are in pieces, not thousandths', f.topProducts.every((p) => p.qty < 100000 && typeof p.name === 'string'))
const text = JSON.stringify(f)
ok('no secrets or internal ids go to the model', !/password|pinHash|"pin"|token|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text), text.match(/password|pinHash|"pin"|token|[0-9a-f]{8}-[0-9a-f]{4}-/i)?.[0] ?? '')
ok('the payload is small', text.length < 20000, String(text.length))

// Отказы
ok('kassa-only employee cannot order a summary', (await j('POST', '/reports/ai-summary', { from: today, to: today }, waiter)).s === 403)
ok('bad dates -> 400', (await j('POST', '/reports/ai-summary', { from: 'x', to: today }, owner)).s === 400)
ok('bad range -> 400', (await j('POST', '/reports/ai-summary', { from: '2026-03-10', to: '2026-03-01', dry: true }, owner)).s === 400)
if (!status.configured) {
  const r = await j('POST', '/reports/ai-summary', { from: today, to: today }, owner)
  ok('without a key: a clear refusal, not a crash', r.s === 503 && r.error === 'ai_not_configured')
} else {
  console.log('SKIP  real summary (a key is set; a real request costs money — run it from the panel)')
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
