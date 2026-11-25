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

// ── Бесплатная сводка: текст пишет программа, модель не нужна ──
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/ |,/g, ' ')
const dg = await j('GET', `/reports/digest?from=${today}&to=${today}&lang=ru`, null, owner)
ok('free digest works without any key', dg.s === 200 && typeof dg.text === 'string' && dg.text.length > 100 && dg.aiAvailable === status.configured)
ok('digest has all sections', ['Главное', 'Что продаётся', 'Сотрудники', 'Стоит проверить', 'На что посмотреть сегодня'].every((h) => dg.text.includes(h)), dg.text.split('\n').filter((l) => l && l.length < 30).join(' | '))
ok('digest shows the real revenue and receipt count', dg.text.includes(`Выручка ${fmt(sum.totals.revenue)} сум, чеков ${sum.totals.receipts}`), dg.text.split('\n')[1])
ok('digest names the top product and the top employee', dg.text.includes(sum.byProduct[0].name.ru) && dg.text.includes(sum.byWaiter[0].name))
const risky = sus.byUser.filter((u) => u.level !== 'low')
ok('digest lists risky employees or says there are none', risky.length ? dg.text.includes(risky[0].name) && dg.text.includes('Это не обвинение') : dg.text.includes('Подозрительных действий за период нет'))
ok('no more than three to-do points', dg.text.split('На что посмотреть сегодня')[1].split('\n').filter((l) => /^\d\./.test(l)).length <= 3)
const dgUz = await j('GET', `/reports/digest?from=${today}&to=${today}&lang=uz`, null, owner)
ok('digest in Uzbek', dgUz.s === 200 && dgUz.text.includes('Asosiysi') && dgUz.text.includes('so‘m') && !/[а-яё]{4,}/i.test(dgUz.text.replace(new RegExp(sum.byWaiter.map((w) => w.name).join('|') || 'x', 'g'), '')), dgUz.text.match(/[а-яё]{4,}/i)?.[0] ?? '')
// Пустой период — без ошибок и без выдуманных цифр
const empty = await j('GET', '/reports/digest?from=2020-01-01&to=2020-01-01&lang=ru', null, owner)
ok('empty period: says there were no sales', empty.s === 200 && empty.text.includes('продаж не было') && empty.text.includes('Особых замечаний нет'))
ok('kassa-only employee cannot open the digest', (await j('GET', `/reports/digest?from=${today}&to=${today}`, null, waiter)).s === 403)

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
