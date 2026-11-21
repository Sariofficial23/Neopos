import { money, qtyText, type Boot, type Lang, type Receipt, type ReceiptItem } from './api'

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
      <section class="slip">
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
}
export const desktop: Desktop | null = (window as unknown as { neoposDesktop?: Desktop }).neoposDesktop ?? null

/** Отдельный документ для печати без окна подтверждения (приложение Windows). */
export const slipDocument = (slips: string[]) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}${SLIP_CSS}</style></head><body><div id="print-root">${slips.join('')}</div></body></html>`

/**
 * Отправляет подготовленные бегунки на печать.
 * В приложении для Windows — сразу на выбранный принтер; в браузере — через окно печати.
 * Возвращает текст ошибки, если приложение не смогло напечатать, иначе null.
 */
export async function printSlips(slips: string[]): Promise<string | null> {
  if (!slips.length) return null
  if (desktop) {
    const res = await desktop.print(slipDocument(slips))
    return res.ok ? null : (res.error ?? 'print_failed')
  }
  browserPrint(slips)
  return null
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
