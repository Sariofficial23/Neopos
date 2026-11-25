// Локальная сеть с несколькими кассами: четыре кассы подключаются к главному терминалу по сетевому адресу
// (не через 127.0.0.1) и работают одновременно — с интернетом и без него.
// Облако — запущенный сервер разработки; главный терминал тест поднимает сам, с чистой базой.
// Запуск: node server/scripts/lan-multi-terminal-test.mjs <логин> <пароль>   (после pos-flow-test)
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import http from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLOUD = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000'
const PORT = 4112
const PROXY_PORT = 4113
const [login, password] = process.argv.slice(2)
// Сетевой адрес этого компьютера: по нему ходили бы остальные кассы заведения.
const lanIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address
if (!lanIp) {
  console.log('SKIP  этот компьютер не подключён к локальной сети — проверять нечем')
  process.exit(0)
}
const LAN = `http://${lanIp}:${PORT}`

const call = (origin) => async (m, p, body, t) => {
  const started = Date.now()
  const r = await fetch(origin + '/api' + p, {
    method: m,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  times.push(Date.now() - started)
  return Array.isArray(d) ? { s: r.status, list: d } : { s: r.status, ...d }
}
const times = []
const cloud = call(CLOUD)
const lan = call(LAN)
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

// ── «Интернет» между главным терминалом и облаком, который можно выключить ──
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
const roles = (await cloud('GET', '/roles', null, panel)).list
const adminRole = roles.find((x) => !x.isOwner && x.panelAccess && x.terminalAccess)
await cloud('PATCH', '/roles/' + adminRole.id, { name: adminRole.name, panelAccess: true, terminalAccess: true, permissions: [...new Set([...adminRole.permissions, 'receipt.see_all'])] }, panel)
const act = await cloud('POST', '/pos/activate', { login, password, name: 'Main terminal (LAN test)' })
const cAdmin = (await cloud('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
await cloud('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)
const cBoot = await cloud('GET', '/pos/bootstrap', null, cAdmin)
if (!cBoot.shift) await cloud('POST', '/pos/shift/open', { openingCash: 0 }, cAdmin)

// ── Главный терминал: слушает все адреса компьютера, как в приложении ──
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kassaDir = resolve(serverDir, '../desktop/kassa')
const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: serverDir,
  env: {
    ...process.env,
    NEOPOS_LOCAL: '1',
    CLOUD_URL: `http://127.0.0.1:${PROXY_PORT}`,
    SYNC_TOKEN: act.deviceToken,
    SYNC_SECONDS: '1',
    PGLITE_DIR: mkdtempSync(join(tmpdir(), 'neopos-lan-')),
    PORT: String(PORT),
    HOST: '0.0.0.0',
    JWT_SECRET: 'lan-test-secret-not-the-cloud-one',
    TELEGRAM_BOT_TOKEN: '',
    ...(existsSync(join(kassaDir, 'index.html')) ? { KASSA_DIR: kassaDir } : {}),
  },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const status = async () => (await fetch(LAN + '/api/sync/status')).json()

try {
  const first = await until(async () => { const s = await status(); return s.lastSyncAt ? s : null }, 90_000)
  ok(`main terminal is reachable by its network address ${lanIp}`, first?.mode === 'local' && first.online === true)
  if (existsSync(join(kassaDir, 'index.html'))) {
    const page = await fetch(LAN + '/')
    ok('kassa screen is served over the network', page.status === 200 && (await page.text()).includes('<div id="root">'))
  }

  // ── Четыре кассы подключаются по сети ──
  const kassas = []
  for (let i = 1; i <= 4; i++) {
    const a = await lan('POST', '/pos/activate', { login, password, name: `LAN kassa ${i}` })
    // Кассы 1 и 2 — администратор, 3 и 4 — официант (один и тот же сотрудник на двух кассах).
    const pin = await lan('POST', '/pos/pin', { pin: i <= 2 ? '2222' : '1111' }, a.deviceToken)
    kassas.push({ n: i, device: a.deviceToken, token: pin.token })
  }
  ok('4 kassas activated and logged in over the network', kassas.every((k) => k.device && k.token))
  const [k1, k2, k3, k4] = kassas

  // ── Список касс в окне «Локальная сеть»: кто подключён ──
  // Касса самого главного терминала получает свой токен у локального сервера (как это делает приложение).
  const adopt = await (await fetch(`http://127.0.0.1:${PORT}/api/sync/adopt`, { method: 'POST', headers: { Authorization: 'Bearer ' + act.deviceToken } })).json()
  await lan('POST', '/pos/ping', null, adopt.deviceToken)
  for (const k of [k1, k2, k3]) await lan('POST', '/pos/ping', null, k.device)
  // Несколько кругов обмена с облаком не должны стереть отметки «на связи».
  await wait(3500)
  const seenList = (await lan('GET', '/pos/terminals', null, k1.device)).list
  const names = (f) => seenList.filter(f).map((t) => t.name)
  ok('kassa list: main terminal is marked and online', seenList.some((t) => t.main && t.online), JSON.stringify(seenList.map((t) => [t.name, t.online, t.main])).slice(0, 200))
  // Вход по ПИН-коду тоже отмечает кассу на связи, поэтому подключены все четыре.
  ok('kassa list: all 4 kassas are shown as connected', ['LAN kassa 1', 'LAN kassa 2', 'LAN kassa 3', 'LAN kassa 4'].every((n) => names((t) => t.online).includes(n)), names((t) => t.online).join(', '))
  ok('kassa list: this kassa is marked', seenList.filter((t) => t.me).length === 1 && seenList.find((t) => t.me).name === 'LAN kassa 1')
  ok('kassa list needs a device token', (await lan('GET', '/pos/terminals')).s === 401)
  const cloudMain = (await cloud('GET', '/terminals', null, panel)).terminals.find((t) => t.name === 'Main terminal (LAN test)' && t.online)
  ok('panel in the cloud sees the main terminal kassa as online', !!cloudMain)
  const boot = await lan('GET', '/pos/bootstrap', null, k1.token)
  const cash = boot.paymentMethods.find((m) => m.kind === 'cash').id
  const dishes = boot.products.filter((p) => p.price > 0 && !p.byWeight)
  const busy = (await lan('GET', '/pos/receipts', null, k1.token)).busyTables
  const free = boot.halls.flatMap((h) => h.tables).filter((t) => !busy.includes(t.id))
  ok('enough free tables for the test', free.length >= 6, String(free.length))

  // 1. Четыре кассы одновременно открывают чеки за разными столами
  const opened = await Promise.all(kassas.map((k, i) => lan('POST', '/pos/receipts', { tableId: free[i].id, guests: 2 }, k.token)))
  const numbers = opened.map((r) => r.number)
  ok('4 receipts opened at the same moment, numbers do not repeat', opened.every((r) => r.s === 200) && new Set(numbers).size === 4, numbers.join(','))

  // 2. Две кассы одновременно открывают один и тот же стол — чек должен быть один
  const [a, b] = await Promise.all([lan('POST', '/pos/receipts', { tableId: free[4].id, guests: 1 }, k1.token), lan('POST', '/pos/receipts', { tableId: free[4].id, guests: 1 }, k2.token)])
  const onTable = (await lan('GET', '/pos/receipts', null, k1.token)).receipts.filter((r) => r.tableId === free[4].id)
  ok('two kassas opening the same table get one receipt', a.s === 200 && b.s === 200 && a.id === b.id && onTable.length === 1, `${a.id === b.id} / ${onTable.length}`)

  // 3. Две кассы одновременно добавляют блюда в один чек — ничего не теряется
  const adds = []
  for (let i = 0; i < 10; i++) {
    adds.push(lan('POST', `/pos/receipts/${a.id}/items`, { productId: dishes[0].id, qty: 1000 }, k1.token))
    adds.push(lan('POST', `/pos/receipts/${a.id}/items`, { productId: dishes[1].id, qty: 1000 }, k2.token))
  }
  const addRes = await Promise.all(adds)
  const shared = await lan('GET', `/pos/receipts/${a.id}`, null, k1.token)
  const qty = (id) => shared.items.filter((i) => i.productId === id && !i.voided).reduce((s, i) => s + i.qty, 0)
  ok('20 simultaneous additions from 2 kassas: nothing lost', addRes.every((r) => r.s === 200) && qty(dishes[0].id) === 10000 && qty(dishes[1].id) === 10000 && shared.subtotal === (dishes[0].price + dishes[1].price) * 10, `${qty(dishes[0].id)} / ${qty(dishes[1].id)} / ${shared.subtotal}`)

  // 4. Касса видит то, что сделано на другой кассе
  const seenBy2 = (await lan('GET', '/pos/receipts', null, k2.token)).receipts
  ok('kassa 2 immediately sees receipts opened on kassas 1, 3 and 4', opened.every((r) => seenBy2.some((x) => x.id === r.id)))
  // Официант с кассы 3 не может зайти за стол администратора, но видит, что стол занят
  const w = await lan('GET', '/pos/receipts', null, k3.token)
  ok('waiter sees the admin table as busy and cannot open it', w.busyTables.includes(free[0].id) && (await lan('POST', '/pos/receipts', { tableId: free[0].id }, k3.token)).s === 403)
  // Один официант на двух кассах: чек с кассы 3 открывается на кассе 4
  ok('same waiter on two kassas works with the same receipt', (await lan('POST', `/pos/receipts/${opened[2].id}/items`, { productId: dishes[0].id, qty: 1000 }, k4.token)).s === 200)

  // Каждая касса добавляет блюда в свой чек
  await Promise.all(kassas.map((k, i) => (i === 2 ? null : lan('POST', `/pos/receipts/${opened[i].id}/items`, { productId: dishes[i % dishes.length].id, qty: 2000 }, k.token))))

  // 5. Интернет пропал: все четыре кассы продолжают работать и оплачивают чеки одновременно
  internet = false
  ok('main terminal noticed that the internet is gone', !!(await until(async () => { const s = await status(); return s.online === false ? s : null })))
  const pays = await Promise.all(
    kassas.map(async (k, i) => {
      const full = await lan('GET', `/pos/receipts/${opened[i].id}`, null, k.token)
      return lan('POST', `/pos/receipts/${opened[i].id}/pay`, { payments: [{ methodId: cash, amount: full.total }] }, k.token)
    }),
  )
  ok('offline: 4 kassas paid their receipts at the same moment', pays.every((p) => p.s === 200), pays.map((p) => p.s).join(','))
  const offNew = await Promise.all(kassas.map((k, i) => lan('POST', '/pos/receipts', { tableId: free[i].id, guests: 1 }, k.token)))
  ok('offline: tables are free again and new receipts open', offNew.every((r) => r.s === 200) && new Set([...numbers, ...offNew.map((r) => r.number)]).size === 8)
  ok('offline: waiting receipts are counted', (await status()).pendingReceipts >= 4, String((await status()).pendingReceipts))
  ok('offline: cloud has none of it yet', (await cloud('GET', `/pos/receipts/${opened[0].id}`, null, cAdmin)).status !== 'closed')

  // 6. Интернет вернулся: всё уходит в облако
  internet = true
  const back = await until(async () => { const s = await status(); return s.online ? s : null })
  ok('back online, queue is empty', back?.online === true && back.pendingReceipts === 0)
  await wait(2500)
  const inCloud = await Promise.all(opened.map((r) => cloud('GET', `/pos/receipts/${r.id}`, null, cAdmin)))
  ok('cloud received all 4 paid receipts with the same numbers', inCloud.every((r, i) => r.status === 'closed' && r.number === opened[i].number), inCloud.map((r) => r.status).join(','))
  ok('cloud received the shared receipt with all 20 items', (await cloud('GET', `/pos/receipts/${a.id}`, null, cAdmin)).subtotal === shared.subtotal)
  const main = (await cloud('GET', '/terminals', null, panel)).terminals.find((t) => t.main && t.syncOnline)
  ok('panel shows the main terminal as online', !!main)

  // уборка в облаке: открытые пробные чеки без позиций отменяем, общий оплачиваем
  await wait(1500)
  for (const r of offNew) await lan('DELETE', `/pos/receipts/${r.id}`, null, k1.token)
  const fullShared = await lan('GET', `/pos/receipts/${a.id}`, null, k1.token)
  await lan('POST', `/pos/receipts/${a.id}/pay`, { payments: [{ methodId: cash, amount: fullShared.total }] }, k1.token)
  await wait(3500)

  const sorted = [...times].sort((x, y) => x - y)
  console.log(`\nЗапросов: ${times.length}, обычное время ответа ${sorted[Math.floor(sorted.length / 2)]} мс, самое долгое ${sorted.at(-1)} мс`)
} finally {
  child.kill()
  proxy.close()
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
