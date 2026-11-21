// NeoPos Kassa — Windows ilovasi. Kassa sahifasini oynada ochadi va chekni
// so'ramasdan tanlangan printerga chiqaradi.
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

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
