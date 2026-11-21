// Kassa sahifasiga faqat shu bir nechta funksiya beriladi — fayllar va tizimga kirish yo'q.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('neoposDesktop', {
  /** { version, printer } */
  info: () => ipcRenderer.invoke('neopos:info'),
  /** Windows'dagi printerlar ro'yxati */
  printers: () => ipcRenderer.invoke('neopos:printers'),
  /** Chek chiqadigan printerni tanlash ('' — asosiy printer) */
  setPrinter: (name) => ipcRenderer.invoke('neopos:set-printer', name),
  /** To'liq HTML hujjatni so'ramasdan chop etish → { ok, error? } */
  print: (html) => ipcRenderer.invoke('neopos:print', html),
  /** Проверить и установить новую версию программы → { status, version? } */
  checkUpdate: () => ipcRenderer.invoke('neopos:check-update'),
})
