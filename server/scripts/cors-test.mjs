// Проверка, что браузер с другого домена (панель и касса на Vercel) может менять и удалять данные.
// Запуск: node server/scripts/cors-test.mjs [адрес сервера, по умолчанию локальный]
const B = process.argv[2] ?? 'http://127.0.0.1:4000'
const ORIGINS = ['https://neopos-panel.vercel.app', 'https://neopos-terminal.vercel.app']
let failed = 0

for (const origin of ORIGINS) {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const r = await fetch(`${B}/api/staff/00000000-0000-4000-8000-000000000000`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    const methods = (r.headers.get('access-control-allow-methods') ?? '').toUpperCase().split(/\s*,\s*/)
    const allowOrigin = r.headers.get('access-control-allow-origin')
    const headers = (r.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    const ok =
      r.status < 300 &&
      (allowOrigin === origin || allowOrigin === '*') &&
      methods.includes(method) &&
      headers.includes('authorization') &&
      headers.includes('content-type')
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${method} from ${origin}  (methods: ${methods.join(',')})`)
  }
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
