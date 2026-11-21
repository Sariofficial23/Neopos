// Логотип и фото заведения: загрузка из панели, показ на экране ПИН-кода кассы.
// Запуск: node server/scripts/brand-test.mjs <логин> <пароль>   (демо-заведение)
import { readFileSync } from 'node:fs'
const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const [login, password] = process.argv.slice(2)
const j = async (m, p, body, t) => {
  const r = await fetch(B + p, {
    method: m,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  return { s: r.status, ...d }
}
let failed = 0
const ok = (name, cond, extra = '') => {
  if (!cond) failed++
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''))
}
const dataUrl = (file, mime) => `data:${mime};base64,${readFileSync(new URL(file, import.meta.url)).toString('base64')}`

const { token: panel } = await j('POST', '/auth/login', { login, password })
const act = await j('POST', '/pos/activate', { login, password, name: 'Brand test kassa' })
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token

ok('waiter cannot upload', (await j('PUT', '/brand/logo', { image: 'data:image/png;base64,AAAA' }, waiter)).s === 403)
ok('not an image -> 400', (await j('PUT', '/brand/logo', { image: 'data:text/html;base64,AAAA' }, panel)).s === 400)
const big = 'data:image/png;base64,' + Buffer.alloc(400_000).toString('base64')
ok('too big logo -> 413', (await j('PUT', '/brand/logo', { image: big }, panel)).error === 'image_too_big')

const logo = await j('PUT', '/brand/logo', { image: dataUrl('../../terminal/public/brand/icon.png', 'image/png') }, panel)
ok('upload logo', logo.s === 200 && !!logo.logo, logo.logo ?? logo.error)
const photo = await j('PUT', '/brand/photo', { image: dataUrl('../../terminal/src/assets/cafe.webp', 'image/webp') }, panel)
ok('upload photo', photo.s === 200 && !!photo.photo)

const info = await j('GET', '/pos/device', null, act.deviceToken)
ok('PIN screen info with device token', info.s === 200 && info.venue && info.logo === logo.logo && info.photo === photo.photo, `${info.venue} ${info.lang}`)
ok('device info needs a device token', (await j('GET', '/pos/device', null, panel)).s === 401)
const img = await fetch(B.replace(/\/api$/, '') + info.photo)
ok('photo served publicly with long cache', img.ok && img.headers.get('content-type') === 'image/webp' && /immutable/.test(img.headers.get('cache-control') ?? ''))
const boot = await j('GET', '/pos/bootstrap', null, waiter)
ok('bootstrap carries brand', boot.brand?.photo === photo.photo)

if (process.argv[4] !== 'keep') {
  await j('DELETE', '/brand/logo', null, panel)
  const after = await j('DELETE', '/brand/photo', null, panel)
  ok('delete both', after.logo === null && after.photo === null)
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
