// Собирает то, что нужно главному терминалу для работы без интернета:
//   desktop/kassa  — экран кассы (обращается к серверу по тому же адресу, с которого открыт)
//   desktop/server — сервер NeoPos одним файлом и папка миграций базы
// Запуск: node desktop/scripts/build-local.mjs   (из корня репозитория)
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const desktop = join(root, 'desktop')

rmSync(join(desktop, 'kassa'), { recursive: true, force: true })
rmSync(join(desktop, 'server'), { recursive: true, force: true })
mkdirSync(join(desktop, 'server'), { recursive: true })

// Экран кассы: без VITE_API_URL запросы идут на тот же адрес, откуда открыта страница.
// Vite берём тот, что установлен для кассы (он может лежать и в общей папке node_modules).
const vite = join(dirname(createRequire(join(root, 'terminal/package.json')).resolve('vite/package.json')), 'bin/vite.js')
execFileSync(process.execPath, [vite, 'build', '--outDir', join(desktop, 'kassa'), '--emptyOutDir'], {
  cwd: join(root, 'terminal'),
  env: { ...process.env, VITE_API_URL: '', VITE_DOWNLOAD_URL: '' },
  stdio: 'inherit',
})

// Сервер: один файл. Встроенная база (PGlite) остаётся отдельным пакетом — ей нужны свои файлы рядом.
await build({
  entryPoints: [join(root, 'server/src/index.ts')],
  outfile: join(desktop, 'server/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@electric-sql/pglite', 'pg', 'pg-native'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})
cpSync(join(root, 'server/drizzle'), join(desktop, 'server/drizzle'), { recursive: true })
console.log('local build ready: desktop/kassa, desktop/server')
