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
  /** Печать на сетевой принтер по IP: { ip, port, width, slips: [html, ...] } → { ok, error? } */
  printNet: (job) => ipcRenderer.invoke('neopos:print-net', job),
  /** Найти принтеры в локальной сети (порт 9100) → [{ ip, network }] */
  scanPrinters: () => ipcRenderer.invoke('neopos:scan-printers'),
  /** Проверить и установить новую версию программы → { status, version? } */
  checkUpdate: () => ipcRenderer.invoke('neopos:check-update'),
  /** Локальная сеть: { mode: 'cloud'|'main'|'lan', host, port, addresses, running, sync } */
  netStatus: () => ipcRenderer.invoke('neopos:net-status'),
  /** Сделать этот компьютер главным терминалом: { token, cloud } → { ok, error? } */
  netMainOn: (cfg) => ipcRenderer.invoke('neopos:net-main-on', cfg),
  /** Найти главный терминал в локальной сети → [{ ip }] */
  netLanFind: () => ipcRenderer.invoke('neopos:net-lan-find'),
  /** Подключить кассу к главному терминалу по адресу → { ok, error? } */
  netLanOn: (host) => ipcRenderer.invoke('neopos:net-lan-on', host),
  /** Вернуться к работе через интернет → { ok, error? } */
  netOff: () => ipcRenderer.invoke('neopos:net-off'),
})
