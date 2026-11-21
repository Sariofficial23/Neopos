import { money, qtyText, type Boot, type Lang, type NetPrinter, type Receipt, type ReceiptItem, type ShiftSummary } from './api'

/**
 * Печать через браузер на основной принтер компьютера (термолента 80 мм).
 * Каждый бегунок — отдельная «страница»: принтер с автообрезкой отрежет их по одному.
 *
 * Чтобы печать шла без окна подтверждения, Chrome запускают с ключом --kiosk-printing.
 */

const words = {
  table: { uz: 'Stol', ru: 'Стол' },
  noTable: { uz: 'Stolsiz', ru: 'Без стола' },
  receipt: { uz: 'Chek', ru: 'Чек' },
  waiter: { uz: 'Ofitsiant', ru: 'Официант' },
  guests: { uz: 'Mehmonlar', ru: 'Гостей' },
  cancel: { uz: 'BEKOR QILINDI', ru: 'ОТМЕНА' },
  note: { uz: 'Izoh', ru: 'Заметка' },
  bill: { uz: 'HISOB', ru: 'СЧЁТ' },
  subtotal: { uz: 'Summa', ru: 'Сумма' },
  discount: { uz: 'Chegirma', ru: 'Скидка' },
  service: { uz: 'Xizmat haqi', ru: 'Обслуживание' },
  total: { uz: 'JAMI', ru: 'ИТОГО' },
  change: { uz: 'Qaytim', ru: 'Сдача' },
  notFiscal: { uz: 'Bu fiskal chek emas', ru: 'Не является фискальным чеком' },
  other: { uz: 'Boshqa', ru: 'Прочее' },
} as const

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const time = (iso: string | Date) =>
  // Время заведения (Ташкент), а не часового пояса, выставленного на компьютере кассы.
  new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function place(r: Receipt, boot: Boot, lang: Lang) {
  if (r.tableName) return `${words.table[lang]} ${r.tableName}`
  return boot.saleTypes.find((s) => s.id === r.saleTypeId)?.name[lang] ?? words.noTable[lang]
}

/** Бегунки на кухню: по одному на каждый отдел. */
export function kitchenSlips(r: Receipt, items: ReceiptItem[], boot: Boot, lang: Lang, cancelled = false): string[] {
  const groups = new Map<string, ReceiptItem[]>()
  for (const i of items) {
    const key = i.departmentId ?? ''
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([depId, list]) => {
    const dep = boot.departments.find((d) => d.id === depId)?.name ?? words.other[lang]
    return `
      <section class="slip" data-dep="${esc(depId)}">
        <div class="c big">${esc(dep)}</div>
        ${cancelled ? `<div class="c inv">${words.cancel[lang]}</div>` : ''}
        <div class="c huge">${esc(place(r, boot, lang))}</div>
        <div class="row"><span>${words.receipt[lang]} №${r.number}</span><span>${time(new Date())}</span></div>
        <div class="row"><span>${words.waiter[lang]}</span><span>${esc(r.waiterName ?? '')}</span></div>
        <div class="row"><span>${words.guests[lang]}</span><span>${r.guests}</span></div>
        <hr />
        ${list
          .map(
            (i) => `
          <div class="kline ${cancelled ? 'strike' : ''}"><b>${qtyText(i.qty)}</b><span>${esc(i.name[lang])}</span></div>
          ${i.comment ? `<div class="note">${words.note[lang]}: ${esc(i.comment)}</div>` : ''}`,
          )
          .join('')}
        ${r.comment && !cancelled ? `<hr /><div class="note">${words.note[lang]}: ${esc(r.comment)}</div>` : ''}
      </section>`
  })
}

/** Счёт гостю (предчек) или итоговый чек после оплаты. */
export function guestReceipt(r: Receipt, boot: Boot, lang: Lang, opts: { final: boolean; change?: number }): string {
  const live = r.items.filter((i) => !i.voided)
  const kv = (k: string, v: string, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${v}</span></div>`
  return `
    <section class="slip">
      <div class="c big">${esc(boot.venue)}</div>
      ${boot.print.address ? `<div class="c">${esc(boot.print.address)}</div>` : ''}
      ${boot.print.phone ? `<div class="c">${esc(boot.print.phone)}</div>` : ''}
      ${boot.print.header ? `<div class="c">${esc(boot.print.header)}</div>` : ''}
      <hr />
      ${opts.final ? '' : `<div class="c big">${words.bill[lang]}</div>`}
      ${kv(`${words.receipt[lang]} №${r.number}`, boot.print.showTime ? time(opts.final && r.closedAt ? r.closedAt : new Date()) : '')}
      ${kv(esc(place(r, boot, lang)), boot.print.showGuests ? `${words.guests[lang]}: ${r.guests}` : '')}
      ${boot.print.showWaiter ? kv(words.waiter[lang], esc(r.waiterName ?? '')) : ''}
      <hr />
      ${live
        .map(
          (i) => `
        <div class="item">${esc(i.name[lang])}</div>
        ${kv(`${qtyText(i.qty)} × ${money(i.price)}`, money(i.total))}`,
        )
        .join('')}
      <hr />
      ${r.discountAmount > 0 || r.serviceAmount > 0 ? kv(words.subtotal[lang], money(r.subtotal)) : ''}
      ${
        r.discountAmount > 0
          ? kv(`${words.discount[lang]}${r.discountKind === 'percent' ? ` ${r.discountValue}%` : ''}`, `−${money(r.discountAmount)}`)
          : ''
      }
      ${r.serviceAmount > 0 ? kv(`${words.service[lang]} ${r.serviceBp / 100}%`, money(r.serviceAmount)) : ''}
      ${kv(words.total[lang], money(r.total), 'total')}
      ${
        opts.final
          ? `<hr />${r.payments.map((p) => kv(esc(p.name[lang]), money(p.amount + (p.kind === 'cash' ? (opts.change ?? 0) : 0)))).join('')}
             ${opts.change ? kv(words.change[lang], money(opts.change)) : ''}`
          : ''
      }
      <hr />
      ${boot.print.footer ? `<div class="c">${esc(boot.print.footer)}</div>` : ''}
      <div class="c small">${words.notFiscal[lang]}</div>
    </section>`
}

/** Отчёт по текущей смене (X-отчёт): продажи, оплата, движение наличных. Смену не закрывает. */
export function shiftReport(s: ShiftSummary, boot: Boot, lang: Lang, shiftNumber: number): string {
  const L = {
    title: { uz: 'SMENA HISOBOTI', ru: 'ОТЧЁТ ПО СМЕНЕ' },
    shift: { uz: 'Smena', ru: 'Смена' },
    receipts: { uz: 'Cheklar', ru: 'Чеков' },
    revenue: { uz: 'TUSHUM', ru: 'ВЫРУЧКА' },
    opening: { uz: 'Smena boshida', ru: 'На начало смены' },
    cashSales: { uz: 'Naqd savdo', ru: 'Продажи наличными' },
    expense: { uz: 'Xarajat', ru: 'Расход' },
    income: { uz: 'Kirim', ru: 'Доход' },
    collection: { uz: 'Inkassatsiya', ru: 'Инкассация' },
    expected: { uz: 'KASSADA', ru: 'В КАССЕ' },
    printed: { uz: 'Chop etildi', ru: 'Напечатано' },
  }
  const kv = (k: string, v: string, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${v}</span></div>`
  return `
    <section class="slip">
      <div class="c big">${esc(boot.venue)}</div>
      <div class="c big">${L.title[lang]}</div>
      ${kv(`${L.shift[lang]} №${shiftNumber}`, time(new Date()))}
      <hr />
      ${kv(L.receipts[lang], String(s.receipts))}
      ${s.byMethod.map((m) => kv(esc(m.name[lang]), money(m.amount))).join('')}
      ${kv(L.revenue[lang], money(s.revenue), 'total')}
      <hr />
      ${kv(L.opening[lang], money(s.openingCash))}
      ${kv(L.cashSales[lang], money(s.cashSales))}
      ${s.movements
        .map((m) => {
          const type = m.type ?? (m.kind === 'out' ? 'expense' : 'income')
          const label = [L[type][lang], m.category, m.note].filter(Boolean).map((x) => esc(String(x))).join(': ')
          return kv(label, `${m.kind === 'out' ? '−' : '+'}${money(m.amount)}`)
        })
        .join('')}
      ${kv(L.expected[lang], money(s.expectedCash), 'total')}
      <hr />
      <div class="c small">${L.printed[lang]}: ${esc(boot.user.name)}</div>
    </section>`
}

/** Вид бумаги: термолента 80 мм, рабочая ширина 72 мм. */
const SLIP_CSS = `
  #print-root { width: 72mm; margin: 0 auto; color: #000; font-family: 'Courier New', 'Liberation Mono', monospace; font-size: 12px; line-height: 1.35; }
  #print-root .slip { padding: 2mm 0 6mm; break-after: page; page-break-after: always; }
  #print-root .slip:last-child { break-after: auto; page-break-after: auto; }
  #print-root hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  #print-root .c { text-align: center; }
  #print-root .big { font-size: 16px; font-weight: 700; }
  #print-root .huge { font-size: 24px; font-weight: 700; margin: 1mm 0; }
  #print-root .small { font-size: 10px; margin-top: 1mm; }
  #print-root .inv { background: #000; color: #fff; font-size: 16px; font-weight: 700; padding: 1mm 0; margin: 1mm 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #print-root .row { display: flex; justify-content: space-between; gap: 3mm; }
  #print-root .row span:last-child { text-align: right; white-space: nowrap; }
  #print-root .item { font-weight: 700; margin-top: 1mm; }
  #print-root .total { font-size: 17px; font-weight: 700; margin-top: 1mm; }
  #print-root .kline { display: flex; gap: 3mm; font-size: 17px; font-weight: 700; margin: 1.5mm 0; }
  #print-root .kline b { min-width: 9mm; }
  #print-root .strike { text-decoration: line-through; }
  #print-root .note { font-size: 13px; font-style: italic; margin: 0 0 1.5mm 12mm; }
`
const PAGE_CSS = '@page { size: 80mm auto; margin: 0; } html, body { margin: 0; background: #fff; }'

/** Мост к приложению NeoPos Kassa для Windows — есть только внутри приложения. */
type Desktop = {
  info: () => Promise<{ version: string; printer: string } | null>
  printers: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>
  setPrinter: (name: string) => Promise<boolean>
  print: (html: string) => Promise<{ ok: boolean; error?: string }>
  /** Есть с версии приложения 0.1.4: печать на сетевой принтер по IP и поиск принтеров */
  printNet?: (job: { ip: string; port: number; width: number; slips: string[] }) => Promise<{ ok: boolean; error?: string }>
  scanPrinters?: () => Promise<{ ip: string; network: string }[]>
  /** Есть с версии приложения 0.1.3: проверить и установить новую версию программы */
  checkUpdate?: () => Promise<{ status: 'latest' | 'installing' | 'dev' | 'error'; version?: string; error?: string }>
}
export const desktop: Desktop | null = (window as unknown as { neoposDesktop?: Desktop }).neoposDesktop ?? null

/** Отдельный документ для печати без окна подтверждения (приложение Windows). */
export const slipDocument = (slips: string[]) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}${SLIP_CSS}</style></head><body><div id="print-root">${slips.join('')}</div></body></html>`

// ───────────── Куда печатать ─────────────

let netPrinters: NetPrinter[] = []
let printLang: Lang = 'uz'

/** Список сетевых принтеров заведения и язык сообщений. Вызывается при загрузке кассы. */
export function setPrintContext(printers: NetPrinter[], lang: Lang) {
  netPrinters = printers
  printLang = lang
}

const PRINT_ERRORS: Record<string, { uz: string; ru: string }> = {
  printer_timeout: { uz: 'printer javob bermadi', ru: 'принтер не ответил' },
  printer_refused: { uz: 'printer ulanishni rad etdi', ru: 'принтер отклонил подключение' },
  printer_unreachable: { uz: 'printer tarmoqda topilmadi', ru: 'принтер не найден в сети' },
}
const errorText = (code?: string) => (code && PRINT_ERRORS[code]?.[printLang]) || code || 'error'

/**
 * Отправляет подготовленные бегунки на печать.
 *
 * В приложении для Windows с настроенными сетевыми принтерами каждый бегунок кухни уходит
 * на принтеры своего отдела, а счета, чеки гостю и отчёты — на принтер «чеки гостям».
 * Отдел без своего принтера печатается на принтере чеков. Всё, для чего сетевого принтера нет,
 * печатается как раньше: на принтер Windows без окна или через окно печати браузера.
 * Возвращает текст ошибки, если что-то не напечаталось, иначе null.
 */
export async function printSlips(slips: string[]): Promise<string | null> {
  if (!slips.length) return null
  const live = netPrinters.filter((p) => p.active)
  const errors: string[] = []
  let local = slips

  if (desktop?.printNet && live.length) {
    local = []
    const byPrinter = new Map<string, { printer: NetPrinter; docs: string[] }>()
    for (const html of slips) {
      const dep = /data-dep="([^"]*)"/.exec(html)?.[1]
      let targets = dep ? live.filter((p) => p.departmentIds.includes(dep)) : []
      if (!targets.length) targets = live.filter((p) => p.receipts)
      if (!targets.length) {
        local.push(html)
        continue
      }
      for (const printer of targets) {
        const entry = byPrinter.get(printer.id) ?? { printer, docs: [] }
        entry.docs.push(slipDocument([html]))
        byPrinter.set(printer.id, entry)
      }
    }
    // Разные принтеры печатают одновременно: кухня и бар получают бегунки сразу.
    const results = await Promise.all(
      [...byPrinter.values()].map(async ({ printer, docs }) => {
        const res = await desktop!.printNet!({ ip: printer.ip, port: printer.port, width: printer.width, slips: docs })
        return res.ok ? null : `${printer.name} (${printer.ip}) — ${errorText(res.error)}`
      }),
    )
    for (const r of results) if (r) errors.push(r)
  }

  if (local.length) {
    if (desktop) {
      const res = await desktop.print(slipDocument(local))
      if (!res.ok) errors.push(res.error ?? 'print_failed')
    } else browserPrint(local)
  }
  return errors.length ? errors.join('; ') : null
}

/** Пробный чек на конкретный сетевой принтер. */
export async function testNetPrinter(printer: NetPrinter, venue: string): Promise<string | null> {
  if (!desktop?.printNet) return 'no_desktop'
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
  const html = `<section class="slip"><div class="c big">${esc(venue)}</div><hr /><div class="c huge">${esc(printer.name)}</div><div class="c">${esc(printer.ip)}:${printer.port}</div><div class="c">Test · Тест · ${now}</div></section>`
  const res = await desktop.printNet({ ip: printer.ip, port: printer.port, width: printer.width, slips: [slipDocument([html])] })
  return res.ok ? null : errorText(res.error)
}

/** Стили для печати из браузера: на экране бегунков не видно, на бумаге — только они. */
function ensureBrowserStyles() {
  if (document.getElementById('print-style')) return
  const st = document.createElement('style')
  st.id = 'print-style'
  st.textContent = `#print-root { display: none; }
@media print {
  ${PAGE_CSS}
  html, body, #root { height: auto !important; }
  body { overflow: visible !important; }
  #root, .toast, .veil { display: none !important; }
  #print-root { display: block; }
  ${SLIP_CSS}
}`
  document.head.append(st)
}

function browserPrint(slips: string[]) {
  ensureBrowserStyles()
  let root = document.getElementById('print-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'print-root'
    document.body.append(root)
  }
  root.innerHTML = slips.join('')
  const clear = () => {
    root!.innerHTML = ''
    window.removeEventListener('afterprint', clear)
  }
  window.addEventListener('afterprint', clear)
  // Даём браузеру отрисовать содержимое, иначе на бумагу уйдёт пустой лист.
  window.setTimeout(() => window.print(), 60)
}

// ───────────── Отчёт за период (кнопка «Создать отчёт») ─────────────

export const REPORT_TYPES = ['standard', 'products', 'categories', 'departments', 'saleTypes', 'staff', 'finance'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

const R = {
  standard: { uz: 'Standart', ru: 'Стандартный' },
  products: { uz: 'Mahsulotlar', ru: 'Товары' },
  categories: { uz: 'Kategoriyalar', ru: 'Категории' },
  departments: { uz: 'Bo‘limlar', ru: 'Отделы' },
  saleTypes: { uz: 'Savdo turi', ru: 'Тип продажи' },
  staff: { uz: 'Xodimlar', ru: 'Сотрудники' },
  finance: { uz: 'Moliyaviy hisobot', ru: 'Финансовый отчёт' },
  report: { uz: 'HISOBOT', ru: 'ОТЧЁТ' },
  receipts: { uz: 'Cheklar', ru: 'Чеков' },
  guests: { uz: 'Mehmonlar', ru: 'Гостей' },
  average: { uz: 'O‘rtacha chek', ru: 'Средний чек' },
  discounts: { uz: 'Chegirmalar', ru: 'Скидки' },
  service: { uz: 'Xizmat haqi', ru: 'Обслуживание' },
  revenue: { uz: 'TUSHUM', ru: 'ВЫРУЧКА' },
  payments: { uz: 'To‘lov turlari', ru: 'Оплата' },
  cashOps: { uz: 'Kassa operatsiyalari', ru: 'Операции кассы' },
  expense: { uz: 'Xarajatlar', ru: 'Расходы' },
  income: { uz: 'Kirimlar', ru: 'Доходы' },
  collection: { uz: 'Inkassatsiya', ru: 'Инкассация' },
  voids: { uz: 'O‘chirilgan pozitsiyalar', ru: 'Удалённые позиции' },
  cost: { uz: 'Tannarx', ru: 'Себестоимость' },
  gross: { uz: 'Yalpi foyda', ru: 'Валовая прибыль' },
  net: { uz: 'SOF FOYDA', ru: 'ЧИСТАЯ ПРИБЫЛЬ' },
  noCost: { uz: 'Tannarxsiz savdo', ru: 'Продажи без себестоимости' },
  total: { uz: 'JAMI', ru: 'ИТОГО' },
  empty: { uz: 'Bu davrda ma’lumot yo‘q', ru: 'За этот период данных нет' },
  noCategory: { uz: 'Kategoriyasiz', ru: 'Без категории' },
  printed: { uz: 'Chop etildi', ru: 'Напечатано' },
} as const

export const reportTypeName = (t: ReportType, lang: Lang) => R[t][lang]

type Named = { uz: string; ru: string }
export type PeriodSummary = {
  totals: { receipts: number; revenue: number; guests: number; discounts: number; service: number; average: number; cost: number; profit: number; noCostAmount: number }
  voids: { count: number; amount: number }
  cash: { expense: number; income: number; collection: number; byCategory: { type: string; name: string | null; parent: string | null; amount: number; count: number }[] }
  byMethod: { id: string; name: Named; amount: number }[]
  bySaleType: { id: string; name: Named; receipts: number; revenue: number }[]
  byWaiter: { id: string; name: string; receipts: number; revenue: number }[]
  byCategory: { id: string | null; name: Named | null; qty: number; amount: number }[]
  byDepartment: { id: string | null; name: Named | null; qty: number; amount: number }[]
  byProduct: { productId: string | null; name: Named; qty: number; amount: number }[]
}

/** Отчёт за период одной «лентой»: тот же HTML показывается на экране и уходит на принтер. */
export function periodReport(s: PeriodSummary, type: ReportType, boot: Boot, lang: Lang, period: string[]): string {
  const kv = (k: string, v: string, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${v}</span></div>`
  const L = (k: keyof typeof R) => R[k][lang]
  const empty = `<div class="c">${L('empty')}</div>`
  const signed = (sign: string, n: number) => (n ? sign : '') + money(n)
  const named = (n: Named | null) => esc(n?.[lang] ?? L('noCategory'))
  const qtyRows = (rows: { name: string; qty: number; amount: number }[]) =>
    rows.length
      ? rows.map((r) => `<div class="item">${r.name}</div>${kv(qtyText(r.qty), money(r.amount))}`).join('') +
        `<hr />${kv(L('total'), money(rows.reduce((a, r) => a + r.amount, 0)), 'total')}`
      : empty
  const countRows = (rows: { name: string; receipts: number; revenue: number }[]) =>
    rows.length
      ? rows.map((r) => kv(`${r.name} (${r.receipts})`, money(r.revenue))).join('') +
        `<hr />${kv(L('total'), money(rows.reduce((a, r) => a + r.revenue, 0)), 'total')}`
      : empty
  const cashList = (kind: string) =>
    s.cash.byCategory
      .filter((c) => c.type === kind)
      .map((c) => kv(esc([c.parent, c.name ?? L('noCategory')].filter(Boolean).join(' → ')) + (c.count > 1 ? ` (${c.count})` : ''), money(c.amount)))
      .join('')

  let body: string
  if (type === 'standard') {
    body = `
      ${kv(L('receipts'), String(s.totals.receipts))}
      ${kv(L('guests'), String(s.totals.guests))}
      ${kv(L('average'), money(s.totals.average))}
      ${s.totals.discounts ? kv(L('discounts'), '−' + money(s.totals.discounts)) : ''}
      ${s.totals.service ? kv(L('service'), money(s.totals.service)) : ''}
      ${kv(L('revenue'), money(s.totals.revenue), 'total')}
      <hr /><div class="item">${L('payments')}</div>
      ${s.byMethod.map((m) => kv(esc(m.name[lang]), money(m.amount))).join('') || kv('—', '0')}
      ${s.bySaleType.length > 1 ? `<hr /><div class="item">${L('saleTypes')}</div>${s.bySaleType.map((x) => kv(`${esc(x.name[lang])} (${x.receipts})`, money(x.revenue))).join('')}` : ''}
      <hr /><div class="item">${L('cashOps')}</div>
      ${kv(L('expense'), signed('−', s.cash.expense))}
      ${kv(L('income'), signed('+', s.cash.income))}
      ${kv(L('collection'), signed('−', s.cash.collection))}
      ${s.voids.count ? `<hr />${kv(`${L('voids')} (${s.voids.count})`, money(s.voids.amount))}` : ''}`
  } else if (type === 'products') {
    body = qtyRows(s.byProduct.map((p) => ({ name: esc(p.name[lang]), qty: p.qty, amount: p.amount })))
  } else if (type === 'categories') {
    body = qtyRows(s.byCategory.map((c) => ({ name: named(c.name), qty: c.qty, amount: c.amount })))
  } else if (type === 'departments') {
    body = qtyRows(s.byDepartment.map((d) => ({ name: named(d.name), qty: d.qty, amount: d.amount })))
  } else if (type === 'saleTypes') {
    body = countRows(s.bySaleType.map((x) => ({ name: esc(x.name[lang]), receipts: x.receipts, revenue: x.revenue })))
  } else if (type === 'staff') {
    body = countRows(s.byWaiter.map((w) => ({ name: esc(w.name), receipts: w.receipts, revenue: w.revenue })))
  } else {
    // Финансовый: выручка − себестоимость − расходы из кассы = чистая прибыль.
    const net = s.totals.revenue - s.totals.cost - s.cash.expense
    body = `
      ${kv(L('revenue'), money(s.totals.revenue), 'total')}
      ${kv(L('cost'), (s.totals.cost ? '−' : '') + money(s.totals.cost))}
      ${kv(L('gross'), money(s.totals.profit))}
      <hr /><div class="item">${L('expense')}</div>
      ${cashList('expense') || kv('—', '0')}
      ${kv(L('expense'), '−' + money(s.cash.expense), 'item')}
      ${s.cash.income ? `<hr /><div class="item">${L('income')}</div>${cashList('income')}${kv(L('income'), '+' + money(s.cash.income), 'item')}` : ''}
      ${s.cash.collection ? kv(L('collection'), money(s.cash.collection)) : ''}
      <hr />${kv(L('net'), money(net), 'total')}
      ${s.totals.noCostAmount ? `<div class="small">${L('noCost')}: ${money(s.totals.noCostAmount)}</div>` : ''}`
  }

  return `
    <section class="slip">
      <div class="c big">${esc(boot.venue)}</div>
      <div class="c big">${L('report')}: ${esc(R[type][lang].toUpperCase())}</div>
      ${period.map((p) => `<div class="c">${esc(p)}</div>`).join('')}
      <hr />
      ${body}
      <hr />
      <div class="c small">${L('printed')}: ${esc(boot.user.name)}, ${time(new Date())}</div>
    </section>`
}

/** Тот же вид ленты для показа на экране. */
export function ensureSlipPreviewStyles() {
  if (document.getElementById('slip-preview-style')) return
  const st = document.createElement('style')
  st.id = 'slip-preview-style'
  st.textContent = SLIP_CSS.replaceAll('#print-root', '.slip-preview')
  document.head.append(st)
}

export const tashkentTime = time
