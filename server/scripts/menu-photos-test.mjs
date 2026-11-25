// Меню в панели: фото товаров и категорий, вкладка «Удалено» и восстановление.
// Запуск: node server/scripts/menu-photos-test.mjs <логин> <пароль>
const B = process.env.API ?? 'http://127.0.0.1:4000/api'
const ORIGIN = B.replace(/\/api$/, '')
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
// Самая маленькая картинка PNG 1x1
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const { token: panel } = await j('POST', '/auth/login', { login, password })
const act = await j('POST', '/pos/activate', { login, password, name: 'Menu photo test' })
const admin = (await j('POST', '/pos/pin', { pin: '2222' }, act.deviceToken)).token
const waiter = (await j('POST', '/pos/pin', { pin: '1111' }, act.deviceToken)).token

const code = String(Date.now()).slice(-9)
const p = await j('POST', '/products', { name: { uz: 'Photo item ' + code, ru: '' }, price: 5000, barcode: code }, panel)
const c = await j('POST', '/categories', { name: { uz: 'Photo cat ' + code, ru: '' }, color: '#5b45e0' }, panel)

// Фото товара
const up = await j('PUT', `/products/${p.id}/image`, { image: PNG }, panel)
ok('product photo uploaded', up.s === 200 && up.image?.startsWith(`/api/media/item/${p.id}?v=`), JSON.stringify(up))
const img = await fetch(ORIGIN + up.image)
ok('photo is served without login as an image', img.status === 200 && img.headers.get('content-type') === 'image/png' && (await img.arrayBuffer()).byteLength > 20)
ok('product list has the photo link', (await j('GET', '/products', null, panel)).list.find((x) => x.id === p.id)?.image === up.image)
ok('kassa bootstrap has the photo link', (await j('GET', '/pos/bootstrap', null, admin)).products.find((x) => x.id === p.id)?.image === up.image)
// Правка товара не должна стирать фото
await j('PATCH', `/products/${p.id}`, { name: { uz: 'Photo item ' + code, ru: '' }, price: 6000, barcode: code }, panel)
ok('editing the product keeps the photo', (await j('GET', '/products', null, panel)).list.find((x) => x.id === p.id)?.image === up.image)
ok('not an image -> 400', (await j('PUT', `/products/${p.id}/image`, { image: 'data:text/html;base64,PGI+' }, panel)).s === 400)
ok('too big -> 413', (await j('PUT', `/products/${p.id}/image`, { image: 'data:image/png;base64,' + 'A'.repeat(400_000) }, panel)).s === 413)
ok('waiter cannot upload', (await j('PUT', `/products/${p.id}/image`, { image: PNG }, waiter)).s === 403)
ok('unknown product -> 404', (await j('PUT', '/products/00000000-0000-4000-8000-000000000000/image', { image: PNG }, panel)).s === 404)

// Фото категории
const cu = await j('PUT', `/categories/${c.id}/image`, { image: PNG }, panel)
ok('category photo uploaded', cu.s === 200 && !!cu.image)
ok('category list and kassa have it', (await j('GET', '/categories', null, panel)).list.find((x) => x.id === c.id)?.image === cu.image && (await j('GET', '/pos/bootstrap', null, admin)).categories.find((x) => x.id === c.id)?.image === cu.image)
const cd = await j('DELETE', `/categories/${c.id}/image`, null, panel)
ok('category photo removed', cd.s === 200 && cd.image === null && (await fetch(ORIGIN + cu.image)).status === 404)

// Удалено и восстановление
await j('DELETE', `/products/${p.id}`, null, panel)
ok('deleted product left the list', !(await j('GET', '/products', null, panel)).list.some((x) => x.id === p.id))
ok('deleted tab shows it', (await j('GET', '/products?deleted=1', null, panel)).list.some((x) => x.id === p.id))
// Штрих-код занят другим товаром — восстановить нельзя
const taker = await j('POST', '/products', { name: { uz: 'Taker ' + code, ru: '' }, price: 1, barcode: code }, panel)
ok('restore refused while the barcode is taken', (await j('POST', `/products/${p.id}/restore`, null, panel)).s === 409)
await j('DELETE', `/products/${taker.id}`, null, panel)
const back = await j('POST', `/products/${p.id}/restore`, null, panel)
ok('restored, switched off, photo kept', back.s === 200 && back.active === false && back.image === up.image && back.deletedAt === null, JSON.stringify(back).slice(0, 120))
ok('restored product is in the list again', (await j('GET', '/products', null, panel)).list.some((x) => x.id === p.id))
ok('restore of a live product -> 404', (await j('POST', `/products/${p.id}/restore`, null, panel)).s === 404)
ok('waiter cannot restore', (await j('POST', `/products/${p.id}/restore`, null, waiter)).s === 403)

// уборка
await j('DELETE', `/products/${p.id}`, null, panel)
await j('DELETE', `/categories/${c.id}`, null, panel)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
