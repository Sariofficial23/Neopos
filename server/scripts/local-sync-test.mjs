// Локальная сеть: главный терминал (локальный сервер) работает без интернета и обменивается с облаком.
// Облако — уже запущенный сервер разработки; локальный сервер тест запускает сам, с чистой базой
// и ДРУГИМ секретом, а «интернет» между ними — маленький посредник, который можно выключить.
// Запуск: node server/scripts/local-sync-test.mjs <логин> <пароль>   (после pos-flow-test)
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLOUD = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000'
const LOCAL = 'http://127.0.0.1:4102'
const PROXY_PORT = 4103
const [login, password] = process.argv.slice(2)

const call = (origin) => async (m, p, body, t) => {
  const r = await fetch(origin + '/api' + p, {
    method: m,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  return Array.isArray(d) ? { s: r.status, list: d } : { s: r.status, ...d }
}
const cloud = call(CLOUD)
const local = call(LOCAL)
let failed = 0
const ok = (name, cond, extra = '') => {
  if (!cond) failed++
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''))
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 30_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* ещё не готово */
    }
    await wait(300)
  }
  return null
}

// ── «Интернет»: посредник между локальным сервером и облаком, который можно выключить ──
let internet = true
const proxy = http.createServer(async (req, res) => {
  if (!internet) return req.socket.destroy()
  const chunks = []
  for await (const c of req) chunks.push(c)
  try {
    const r = await fetch(CLOUD + req.url, {
      method: req.method,
      headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}), ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}) },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    })
    res.writeHead(r.status, { 'Content-Type': 'application/json' })
    res.end(Buffer.from(await r.arrayBuffer()))
  } catch {
    res.writeHead(502).end()
  }
})
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r))

// ── Облако: подготовка ──
const { token: panel } = await cloud('POST', '/auth/login', { login, password })
const act = await cloud('POST', '/pos/activate', { login, password, name: 'Main terminal test' })
ok('cloud: device activated', !!act.deviceToken)
// ПИН-коды переходят на ключ заведения при первом входе через облако.
const cAdmin = (await cloud('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
await cloud('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)
const cBoot = await cloud('GET', '/pos/bootstrap', null, cAdmin)
if (!cBoot.shift) await cloud('POST', '/pos/shift/open', { openingCash: 0 }, cAdmin)
const cloudShift = (await cloud('GET', '/pos/bootstrap', null, cAdmin)).shift
// Товар с остатком: 10 шт по 5000
const cola = await cloud('POST', '/products', { name: { uz: 'Sync Cola ' + Date.now(), ru: '' }, price: 9000 }, panel)
await cloud('POST', '/supplies', { supplier: 'Test', items: [{ productId: cola.id, qty: 10000, cost: 5000 }] }, panel)
const cloudStock = async () => (await cloud('GET', '/stock', null, panel)).products.find((p) => p.id === cola.id).stock
// Номер последнего чека в облаке: новый чек, чтобы узнать текущий максимум
const takeawayC = cBoot.saleTypes.find((s) => s.kind === 'takeaway')
const probe = await cloud('POST', '/pos/receipts', { saleTypeId: takeawayC.id }, cAdmin)
const cloudMax = probe.number

ok('sync: user token is not accepted', (await cloud('GET', '/sync/pull', null, cAdmin)).s === 401)
ok('sync: no token -> 401', (await cloud('GET', '/sync/pull')).s === 401)
ok('sync: foreign tenant rows -> 403', (await cloud('POST', '/sync/push', { shifts: [{ id: cloudShift.id, tenantId: '00000000-0000-4000-8000-000000000000' }] }, act.deviceToken)).s === 403)

// ── Локальный сервер (главный терминал) ──
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'neopos-local-'))
let child = null
const startLocal = () => {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NEOPOS_LOCAL: '1',
      CLOUD_URL: `http://127.0.0.1:${PROXY_PORT}`,
      SYNC_TOKEN: act.deviceToken,
      SYNC_SECONDS: '1',
      PGLITE_DIR: dataDir,
      PORT: '4102',
      JWT_SECRET: 'local-terminal-secret-not-the-cloud-one',
      TELEGRAM_BOT_TOKEN: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}
const stopLocal = async () => {
  child.kill()
  await until(async () => !(await fetch(LOCAL + '/api/health').catch(() => null)), 10_000)
}
const status = async () => (await fetch(LOCAL + '/api/sync/status')).json()
const synced = async (after = new Date()) => until(async () => { const s = await status(); return s.lastSyncAt && new Date(s.lastSyncAt) > after ? s : null })

try {
  startLocal()
  const first = await until(async () => { const s = await status(); return s.lastSyncAt ? s : null }, 90_000)
  ok('local: started and synced with the cloud', first?.mode === 'local' && first.online === true)
  ok('local: does not serve /sync/pull itself', (await local('GET', '/sync/pull', null, act.deviceToken)).s === 404)

  // Касса подключается к главному терминалу теми же данными, что и к облаку
  const lAct = await local('POST', '/pos/activate', { login, password, name: 'Kassa in LAN' })
  ok('local: kassa activation works', !!lAct.deviceToken, JSON.stringify(lAct).slice(0, 80))
  const lPin = await local('POST', '/pos/pin', { pin: '2222' }, lAct.deviceToken)
  ok('local: PIN login works with another server secret', !!lPin.token, JSON.stringify(lPin).slice(0, 80))
  const lAdmin = lPin.token
  ok('local: wrong PIN is rejected', (await local('POST', '/pos/pin', { pin: '9876' }, lAct.deviceToken)).s !== 200)
  const lBoot = await local('GET', '/pos/bootstrap', null, lAdmin)
  ok('local: menu copied', lBoot.products?.length === cBoot.products.length + 1, `${lBoot.products?.length} vs ${cBoot.products.length + 1}`)
  ok('local: halls and payment methods copied', lBoot.halls?.length === cBoot.halls.length && lBoot.paymentMethods?.length === cBoot.paymentMethods.length)
  ok('local: continues the shift opened in the cloud', lBoot.shift?.id === cloudShift.id)

  const cash = lBoot.paymentMethods.find((m) => m.kind === 'cash').id
  const takeaway = lBoot.saleTypes.find((s) => s.kind === 'takeaway')
  const sell = async (qty) => {
    let r = await local('POST', '/pos/receipts', { saleTypeId: takeaway.id }, lAdmin)
    r = await local('POST', `/pos/receipts/${r.id}/items`, { productId: cola.id, qty }, lAdmin)
    const paid = await local('POST', `/pos/receipts/${r.id}/pay`, { payments: [{ methodId: cash, amount: r.total }] }, lAdmin)
    return { ...r, paid }
  }
  const inCloud = async (id) => (await cloud('GET', `/pos/receipts/${id}`, null, cAdmin))

  // 1. Продажа при интернете
  let t = new Date()
  const r1 = await sell(3000)
  ok('local: sale paid', r1.paid.s === 200 && r1.total === 27000, `status=${r1.paid.s} total=${r1.total}`)
  ok('local: receipt number continues after the cloud', r1.number > cloudMax, `${r1.number} > ${cloudMax}`)
  await synced(t)
  await synced()
  const c1 = await inCloud(r1.id)
  ok('cloud: receipt arrived, closed, same number', c1.status === 'closed' && c1.number === r1.number && c1.total === 27000, `status=${c1.status}`)
  ok('cloud: items and payment arrived', c1.items?.length === 1 && c1.payments?.length === 1)
  ok('cloud: stock written off 10 -> 7', (await cloudStock()) === 7000, String(await cloudStock()))
  await synced()
  await synced()
  ok('cloud: repeated sync does not write off twice', (await cloudStock()) === 7000, String(await cloudStock()))
  const lStock = (await local('GET', '/pos/bootstrap', null, lAdmin)).products.find((p) => p.id === cola.id)
  ok('local: got the menu item back from the cloud', !!lStock)

  // 2. Интернет пропал: заведение продолжает работать
  internet = false
  const off = await until(async () => { const s = await status(); return s.online === false ? s : null })
  ok('local: sees that the internet is gone', off?.online === false && !!off.error)
  const r2 = await sell(2000)
  ok('offline: sale works', r2.paid.s === 200 && r2.number === r1.number + 1, `status=${r2.paid.s} number=${r2.number}`)
  const open = await local('POST', '/pos/receipts', { saleTypeId: takeaway.id }, lAdmin)
  await local('POST', `/pos/receipts/${open.id}/items`, { productId: cola.id, qty: 1000 }, lAdmin)
  ok('offline: open receipt is kept locally', (await local('GET', '/pos/receipts', null, lAdmin)).receipts.some((x) => x.id === open.id))
  ok('offline: cloud does not have the sale yet', (await inCloud(r2.id)).s === 404)
  ok('offline: waiting receipts are counted', (await status()).pendingReceipts >= 2, String((await status()).pendingReceipts))

  // 3. Перезапуск главного терминала без интернета: данные и ПИН-коды на месте
  await stopLocal()
  startLocal()
  await until(async () => (await fetch(LOCAL + '/api/health')).ok, 90_000)
  const again = await local('POST', '/pos/pin', { pin: '2222' }, lAct.deviceToken)
  ok('offline restart: PIN login still works', !!again.token, JSON.stringify(again).slice(0, 80))
  const lAdmin2 = again.token
  ok('offline restart: receipts are on disk', (await local('GET', '/pos/receipts', null, lAdmin2)).receipts.some((x) => x.id === open.id))
  const r3 = await local('POST', '/pos/receipts', { saleTypeId: takeaway.id }, lAdmin2)
  ok('offline restart: numbering continues', r3.number === open.number + 1, `${r3.number} after ${open.number}`)

  // 4. Интернет вернулся: всё накопленное уходит в облако
  internet = true
  const back = await until(async () => { const s = await status(); return s.online ? s : null })
  ok('local: back online', back?.online === true && back.pendingReceipts === 0)
  await synced()
  const c2 = await inCloud(r2.id)
  ok('cloud: offline sale arrived', c2.status === 'closed' && c2.total === 18000, `status=${c2.status}`)
  ok('cloud: open receipt arrived too', (await inCloud(open.id)).status === 'open')
  ok('cloud: stock 7 -> 5 (open receipt is not written off)', (await cloudStock()) === 5000, String(await cloudStock()))

  // 5. Удаление позиции на кассе доходит до облака; оплата открытого чека списывает остаток
  const full = await local('GET', `/pos/receipts/${open.id}`, null, lAdmin2)
  const paid = await local('POST', `/pos/receipts/${open.id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, lAdmin2)
  ok('local: open receipt paid after reconnect', paid.s === 200)
  await synced()
  await synced()
  ok('cloud: stock 5 -> 4', (await cloudStock()) === 4000, String(await cloudStock()))
} finally {
  child?.kill()
  proxy.close()
  // пробный чек в облаке убираем, чтобы не мешал другим тестам
  await cloud('DELETE', `/pos/receipts/${probe.id}`, null, cAdmin).catch(() => {})
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
