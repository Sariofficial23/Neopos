// NeoPos Kassa — Windows ilovasi. Kassa sahifasini oynada ochadi va chekni
// so'ramasdan tanlangan printerga chiqaradi.
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')

/** Kassa manzili. Sinov uchun NEOPOS_URL bilan almashtirish mumkin. */
const APP_URL = process.env.NEOPOS_URL || 'https://neopos-terminal.vercel.app'
const ORIGIN = new URL(APP_URL).origin
const SMOKE = process.argv.includes('--smoke')

// ───────────── Sozlamalar (printer, to'liq ekran) ─────────────

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2))
  return next
}

// ───────────── Oyna ─────────────

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit()

/** @type {BrowserWindow | null} */
let win = null

function isOurPage(url) {
  try {
    return url.startsWith('file:') || new URL(url).origin === ORIGIN
  } catch {
    return false
  }
}

function createWindow({ show = true } = {}) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'NeoPos Kassa',
    backgroundColor: '#dfe7fb',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  Menu.setApplicationMenu(null)

  if (show) {
    win.once('ready-to-show', () => {
      if (readSettings().fullscreen) win.setFullScreen(true)
      else win.maximize()
      win.show()
    })
  }

  // Oynada faqat kassa sahifasi ochiladi; boshqa havolalar brauzerda.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOurPage(url)) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })

  // Internet bo'lmasa — "aloqa yo'q" sahifasi, u o'zi qayta urinadi.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url.startsWith(ORIGIN)) {
      win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } })
    }
  })

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (input.key === 'F11') {
      e.preventDefault()
      win.setFullScreen(!win.isFullScreen())
      writeSettings({ fullscreen: win.isFullScreen() })
    } else if (input.key === 'F5' || (input.control && key === 'r')) {
      e.preventDefault()
      win.webContents.reload()
    } else if (input.control && input.shift && key === 'i') {
      win.webContents.toggleDevTools()
    }
  })

  win.on('closed', () => {
    win = null
  })
  return win.loadURL(APP_URL)
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// ───────────── Chop etish ─────────────

/** So'rov faqat kassa sahifasidan kelgan bo'lsa qabul qilinadi. */
function trusted(e) {
  return isOurPage(e.senderFrame?.url ?? '')
}

/**
 * HTML hujjatni ko'rinmas oynada ochib, so'ramasdan printerga yuboradi.
 * Printer tanlanmagan bo'lsa — Windows'dagi asosiy printer.
 */
async function printHtml(html, deviceName) {
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((resolve, reject) => {
      pw.webContents.print(
        { silent: true, printBackground: true, deviceName: deviceName || undefined, margins: { marginType: 'none' } },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'print_failed'))),
      )
    })
  } finally {
    pw.destroy()
  }
}

// ───────────── Печать на сетевой принтер по IP (ESC/POS, порт 9100) ─────────────

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
/** 72 мм рабочей ширины в CSS-пикселях (96 dpi): масштабируем чек под точки принтера. */
const SLIP_CSS_WIDTH = (72 / 25.4) * 96

/** Рисует один чек (HTML) картинкой шириной в точки принтера: 576 для 80 мм, 384 для 58 мм. */
async function renderSlip(html, dots) {
  const w = new BrowserWindow({
    show: false,
    width: dots,
    height: 6000,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, javascript: false },
  })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    w.webContents.setZoomFactor(dots / SLIP_CSS_WIDTH)
    await new Promise((r) => setTimeout(r, 150))
    let img = await w.webContents.capturePage()
    if (img.getSize().width !== dots) img = img.resize({ width: dots, quality: 'best' })
    return img
  } finally {
    w.destroy()
  }
}

/** Картинка → команды ESC/POS: растр GS v 0 частями по 255 строк, пустой низ обрезается. */
function rasterCommands(img) {
  const { width, height } = img.getSize()
  const bmp = img.toBitmap() // BGRA
  const isInk = (x, y) => {
    const i = (y * width + x) * 4
    const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]
    return bmp[i + 3] > 127 && lum < 160
  }
  let last = -1
  for (let y = height - 1; y >= 0 && last < 0; y--) {
    for (let x = 0; x < width; x += 2) {
      if (isInk(x, y)) {
        last = y
        break
      }
    }
  }
  const rows = Math.max(1, last + 16)
  const bytesPerRow = Math.ceil(width / 8)
  const parts = []
  for (let top = 0; top < rows; top += 255) {
    const h = Math.min(255, rows - top)
    const data = Buffer.alloc(bytesPerRow * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < width; x++) {
        if (top + y < height && isInk(x, top + y)) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8]), data)
  }
  return Buffer.concat(parts)
}

function sendToPrinter(ip, port, buf) {
  return new Promise((resolve, reject) => {
    let finished = false
    const sock = net.connect({ host: ip, port })
    const fail = (err) => {
      if (finished) return
      finished = true
      sock.destroy()
      reject(err)
    }
    sock.setTimeout(5000, () => fail(new Error('printer_timeout')))
    sock.on('error', (err) => fail(new Error(err.code === 'ECONNREFUSED' ? 'printer_refused' : err.code === 'EHOSTUNREACH' ? 'printer_unreachable' : err.message)))
    sock.on('connect', () => sock.end(buf))
    sock.on('close', () => {
      if (finished) return
      finished = true
      resolve()
    })
  })
}

/** Задания на один принтер идут строго по очереди, разные принтеры печатают одновременно. */
const printerQueues = new Map()

async function printToNetwork({ ip, port, width, slips }) {
  const dots = width === 58 ? 384 : 576
  const chunks = [Buffer.from([0x1b, 0x40])] // ESC @ — сброс принтера
  for (const html of slips) {
    chunks.push(rasterCommands(await renderSlip(html, dots)))
    chunks.push(Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00])) // подача 4 строки и отрез
  }
  const job = Buffer.concat(chunks)
  const key = `${ip}:${port}`
  const run = (printerQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => sendToPrinter(ip, port, job))
  printerQueues.set(key, run)
  await run
  return job.length
}

ipcMain.handle('neopos:print-net', async (e, job) => {
  if (!trusted(e)) return { ok: false, error: 'rejected' }
  const ip = String(job?.ip ?? '')
  const port = Number(job?.port ?? 9100)
  const slips = Array.isArray(job?.slips) ? job.slips.filter((s) => typeof s === 'string' && s.length < 2_000_000).slice(0, 30) : []
  if (!IP_RE.test(ip) || !(port > 0 && port < 65536) || !slips.length) return { ok: false, error: 'bad_job' }
  try {
    await printToNetwork({ ip, port, width: Number(job.width), slips })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/** Поиск принтеров: проверяем порт 9100 у всех адресов своей локальной сети (x.x.x.1–254). */
ipcMain.handle('neopos:scan-printers', async (e) => {
  if (!trusted(e)) return []
  const own = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  const prefixes = [...new Set(own.map((a) => a.split('.').slice(0, 3).join('.')))].slice(0, 2)
  const targets = prefixes.flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`)).filter((ip) => !own.includes(ip))
  const found = []
  const probe = (ip) =>
    new Promise((resolve) => {
      const s = net.connect({ host: ip, port: 9100 })
      const done = (ok) => {
        s.destroy()
        if (ok) found.push(ip)
        resolve()
      }
      s.setTimeout(400, () => done(false))
      s.on('connect', () => done(true))
      s.on('error', () => done(false))
    })
  for (let i = 0; i < targets.length; i += 64) await Promise.all(targets.slice(i, i + 64).map(probe))
  return found.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3])).map((ip) => ({ ip, network: ip.split('.').slice(0, 3).join('.') }))
})

ipcMain.handle('neopos:info', (e) => {
  if (!trusted(e)) return null
  return { version: app.getVersion(), printer: readSettings().printer || '' }
})

ipcMain.handle('neopos:printers', async (e) => {
  if (!trusted(e) || !win) return []
  const list = await win.webContents.getPrintersAsync()
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }))
})

ipcMain.handle('neopos:set-printer', (e, name) => {
  if (!trusted(e)) return false
  writeSettings({ printer: typeof name === 'string' ? name.slice(0, 200) : '' })
  return true
})

/**
 * Кнопка «Обновить» в кассе: проверяет новую версию программы. Если она есть — скачивает,
 * устанавливает и перезапускает программу. Если нет — касса просто перезагружает экран.
 */
ipcMain.handle('neopos:check-update', async (e) => {
  if (!trusted(e)) return { status: 'error', error: 'rejected' }
  if (!app.isPackaged) return { status: 'dev' }
  try {
    const { autoUpdater } = require('electron-updater')
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) return { status: 'latest', version: app.getVersion() }
    await result.downloadPromise
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500)
    return { status: 'installing', version: result.updateInfo.version }
  } catch (err) {
    return { status: 'error', error: String(err?.message || err) }
  }
})

ipcMain.handle('neopos:print', async (e, html) => {
  if (!trusted(e) || typeof html !== 'string' || html.length > 2_000_000) return { ok: false, error: 'rejected' }
  try {
    await printHtml(html, readSettings().printer)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

// ───────────── Ishga tushirish ─────────────

/**
 * Tekshiruv rejimi (`npm run smoke`): kassani yashirin oynada ochadi, ko'prik ishlashini,
 * printerlar ro'yxatini va chek ko'rinishini (PDF) tekshiradi, natijani chiqaradi.
 */
async function smoke() {
  const out = { url: APP_URL }
  try {
    await createWindow({ show: false })
    out.title = await win.webContents.executeJavaScript('document.title')
    out.bridge = await win.webContents.executeJavaScript('typeof window.neoposDesktop')
    out.info = await win.webContents.executeJavaScript('window.neoposDesktop.info()')
    out.printers = (await win.webContents.executeJavaScript('window.neoposDesktop.printers()')).length
    const pdfPath = process.argv.find((a) => a.startsWith('--pdf='))?.slice(6)
    if (pdfPath) {
      const html = fs.readFileSync(path.join(__dirname, 'build', 'sample-slip.html'), 'utf8')
      const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
      await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      fs.writeFileSync(pdfPath, await pw.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } }))
      pw.destroy()
      out.pdf = pdfPath
    }
    // --net-print=host:port — отправить пробный чек на сетевой принтер (или его имитацию)
    const netArg = process.argv.find((a) => a.startsWith('--net-print='))?.slice(12)
    if (netArg) {
      const [host, port] = netArg.split(':')
      const sample = fs.readFileSync(path.join(__dirname, 'build', 'sample-slip.html'), 'utf8')
      const started = Date.now()
      out.netBytes = await printToNetwork({ ip: host, port: Number(port), width: 80, slips: [sample, sample] })
      out.netMs = Date.now() - started
    }
    out.ok = out.bridge === 'object' && !!out.title
  } catch (err) {
    out.ok = false
    out.error = String(err?.message || err)
  }
  console.log('SMOKE ' + JSON.stringify(out))
  app.exit(out.ok ? 0 : 1)
}

app.whenReady().then(() => {
  if (SMOKE) return smoke()
  createWindow()
  // Yangi versiya chiqsa — fonda yuklab olinadi va ilova yopilganda o'rnatiladi.
  if (app.isPackaged) {
    try {
      require('electron-updater').autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    } catch {
      /* yangilash serveri sozlanmagan */
    }
  }
})

app.on('window-all-closed', () => app.quit())
