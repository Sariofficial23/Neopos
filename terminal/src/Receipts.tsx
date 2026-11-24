import { useCallback, useEffect, useState } from 'react'
import { api, money, qtyText, type L10n, type OpenReceipt, type Receipt } from './api'
import { useApp } from './app'
import { Dialog } from './Dialogs'
import { guestReceipt, printSlips } from './print'

type HistoryRow = { id: string; action: string; suspicious: boolean; createdAt: string; userName: string | null }

/** Названия действий в истории чека. */
const ACTIONS: Record<string, { uz: string; ru: string }> = {
  'receipt.open': { uz: 'Chek ochildi', ru: 'Чек открыт' },
  'receipt.send': { uz: 'Oshxonaga yuborildi', ru: 'Отправлено на кухню' },
  'receipt.bill': { uz: 'Hisob chop etildi', ru: 'Напечатан счёт' },
  'receipt.discount': { uz: 'Chegirma o‘zgartirildi', ru: 'Изменена скидка' },
  'receipt.pay': { uz: 'To‘lov qabul qilindi', ru: 'Принята оплата' },
  'receipt.close': { uz: 'Chek yopildi', ru: 'Чек закрыт' },
  'receipt.cancel': { uz: 'Savdo bekor qilindi', ru: 'Продажа отменена' },
  'receipt.move': { uz: 'Boshqa stolga ko‘chirildi', ru: 'Перенесён на другой стол' },
  'receipt.refund': { uz: 'Qaytarildi', ru: 'Возврат' },
  'receipt.reopen': { uz: 'Chek qayta ochildi', ru: 'Чек открыт ещё раз' },
  'item.void': { uz: 'Pozitsiya o‘chirildi', ru: 'Удалена позиция' },
  'item.price': { uz: 'Narx o‘zgartirildi', ru: 'Изменена цена' },
  'item.comp': { uz: 'Mehmon qilindi (bepul)', ru: 'Угощение' },
  'item.uncomp': { uz: 'Mehmon qilish bekor qilindi', ru: 'Угощение отменено' },
}

type ClosedRow = {
  id: string
  number: number
  status: string
  tableName: string | null
  saleTypeId: string | null
  waiterName: string | null
  total: number
  closedAt: string | null
}

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }) : ''
const minutes = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))

/**
 * Экран «Чеки» на весь экран: вкладки «Открытые» и «Закрытые» (архив текущей смены).
 * Слева список, справа состав выбранного чека. Открытый чек можно открыть для работы,
 * закрытый — посмотреть и напечатать снова.
 */
export function ReceiptsScreen({
  open: openFromHall,
  initialTab = 'open',
  onOpen,
  onBack,
}: {
  /** Открытые чеки из зала; если экран открыт из «Панели управления», он загружает их сам. */
  open?: OpenReceipt[]
  initialTab?: 'open' | 'closed'
  onOpen: (r: Receipt) => void
  onBack: () => void
}) {
  const { boot, t, lang, fail, toast, can } = useApp()
  const [tab, setTab] = useState<'open' | 'closed'>(initialTab)
  const [loadedOpen, setLoadedOpen] = useState<OpenReceipt[]>([])
  const open = openFromHall ?? loadedOpen
  const [closed, setClosed] = useState<ClosedRow[] | null>(null)
  const [detail, setDetail] = useState<Receipt | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)

  const loadClosed = useCallback(() => {
    api<{ receipts: ClosedRow[] }>('/pos/archive')
      .then((r) => setClosed(r.receipts))
      .catch(fail)
  }, [fail])

  useEffect(() => {
    if (tab === 'closed') loadClosed()
  }, [tab, loadClosed])

  useEffect(() => {
    if (openFromHall) return
    api<{ receipts: OpenReceipt[] }>('/pos/receipts')
      .then((res) => setLoadedOpen(res.receipts))
      .catch(fail)
  }, [openFromHall, fail])

  const place = (r: { tableName: string | null; saleTypeId: string | null }) =>
    r.tableName ? `${t('table')} ${r.tableName}` : (boot.saleTypes.find((s) => s.id === r.saleTypeId)?.name[lang] ?? t('noTable'))

  async function pick(id: string) {
    setSelected(id)
    setDetail(null)
    try {
      setDetail(await api<Receipt>(`/pos/receipts/${id}`))
    } catch (err) {
      setSelected(null)
      fail(err)
    }
  }

  const switchTab = (next: 'open' | 'closed') => {
    setTab(next)
    setSelected(null)
    setDetail(null)
  }

  async function reprint(r: Receipt) {
    const err = await printSlips([guestReceipt(r, boot, lang, { final: true })])
    if (err) toast(`${t('printFailed')}: ${err}`)
  }

  /** История чека: кто и что делал. Подозрительные действия подсвечены. */
  async function showHistory(r: Receipt) {
    try {
      setHistory(await api<HistoryRow[]>(`/pos/receipts/${r.id}/history`))
    } catch (err) {
      fail(err)
    }
  }

  /** «Открыть чек ещё раз»: чек снова открыт, оплата снята. */
  async function reopen(r: Receipt) {
    if (!window.confirm(`№${r.number} · ${money(r.total)}\n\n${t('reopenConfirm')}`)) return
    try {
      onOpen(await api<Receipt>(`/pos/receipts/${r.id}/reopen`, { method: 'POST' }))
    } catch (err) {
      fail(err)
    }
  }

  /** Возврат закрытого чека: только с правом и после подтверждения. */
  async function refund(r: Receipt) {
    if (!window.confirm(`№${r.number} · ${money(r.total)}\n\n${t('refundConfirm')}`)) return
    try {
      setDetail(await api<Receipt>(`/pos/receipts/${r.id}/refund`, { method: 'POST' }))
      loadClosed()
      toast(t('refund'))
    } catch (err) {
      fail(err)
    }
  }

  const closedSum = (closed ?? []).filter((r) => r.status === 'closed').reduce((s, r) => s + r.total, 0)
  const openSum = open.reduce((s, r) => s + r.total, 0)
  const live = detail?.items.filter((i) => !i.voided) ?? []

  return (
    <>
      <header className="bar" data-scene="hall">
        <button className="ico" onClick={onBack} title={t('back')} aria-label={t('back')}>
          <svg viewBox="0 0 24 24">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <div className="logo" style={{ marginLeft: 6 }}>
          {t('receiptsTitle')}
        </div>
      </header>

      <div className="rc">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'on' : ''} onClick={() => switchTab('open')}>
            {t('rcOpen')} · {open.length}
          </button>
          <button role="tab" aria-selected={tab === 'closed'} className={tab === 'closed' ? 'on' : ''} onClick={() => switchTab('closed')}>
            {t('rcClosed')}
            {closed ? ` · ${closed.length}` : ''}
          </button>
          <span className="rc-sum num">
            {t('rcTotal')}: {money(tab === 'open' ? openSum : closedSum)}
          </span>
        </div>

        <div className="rc-body">
          <div className="rc-list glass">
            {tab === 'open' &&
              (open.length === 0 ? (
                <div className="muted rc-empty">{t('noOpenReceipts')}</div>
              ) : (
                open.map((r) => (
                  <button key={r.id} className={`rc-row ${selected === r.id ? 'on' : ''}`} onClick={() => void pick(r.id)}>
                    <span className="rc-no num">№{r.number}</span>
                    <span className="rc-main">
                      {place(r)}
                      <small>
                        👤 {r.waiterName ?? '—'} · {minutes(r.openedAt)} {t('min')}
                      </small>
                    </span>
                    {r.billPrinted && <span className="rc-chip bill">✓ {t('billPrintedTag')}</span>}
                    <b className="num">{money(r.total)}</b>
                  </button>
                ))
              ))}
            {tab === 'closed' &&
              (!closed ? (
                <div className="muted rc-empty">{t('loading')}</div>
              ) : closed.length === 0 ? (
                <div className="muted rc-empty">{t('archiveEmpty')}</div>
              ) : (
                closed.map((r) => (
                  <button key={r.id} className={`rc-row ${selected === r.id ? 'on' : ''}`} onClick={() => void pick(r.id)}>
                    <span className="rc-no num">№{r.number}</span>
                    <span className="rc-main">
                      {place(r)}
                      <small>
                        👤 {r.waiterName ?? '—'} · {clock(r.closedAt)}
                      </small>
                    </span>
                    {r.status === 'cancelled' && <span className="rc-chip void">{t('cancelled')}</span>}
                    {r.status === 'refunded' && <span className="rc-chip void">↩ {t('refunded')}</span>}
                    <b className={`num ${r.status !== 'closed' ? 'rc-strike' : ''}`}>{money(r.total)}</b>
                  </button>
                ))
              ))}
          </div>

          <aside className="rc-detail glass">
            {!selected ? (
              <div className="muted rc-empty">{t('rcPick')}</div>
            ) : !detail ? (
              <div className="muted rc-empty">{t('loading')}</div>
            ) : (
              <>
                <div className="rc-head">
                  <b>
                    №{detail.number} · {place(detail)}
                  </b>
                  <span className="muted">
                    {t('receiptOwner')}: {detail.waiterName || '—'} · {detail.guests} 👤
                  </span>
                </div>
                <div className="rc-items">
                  {live.length === 0 && <div className="muted">{t('emptyCheck')}</div>}
                  {live.map((i) => (
                    <div key={i.id} className="kv">
                      <span>
                        {qtyText(i.qty)} × {i.name[lang]}
                      </span>
                      <b className="num">{money(i.total)}</b>
                    </div>
                  ))}
                </div>
                <div>
                  {detail.discountAmount > 0 && (
                    <div className="kv">
                      <span>{t('discount')}</span>
                      <span className="num">−{money(detail.discountAmount)}</span>
                    </div>
                  )}
                  {detail.serviceAmount > 0 && (
                    <div className="kv">
                      <span>
                        {t('service')} {detail.serviceBp / 100}%
                      </span>
                      <span className="num">{money(detail.serviceAmount)}</span>
                    </div>
                  )}
                  <div className="kv total">
                    <span>{t('rcTotal')}</span>
                    <b className="num">{money(detail.total)}</b>
                  </div>
                  {detail.payments.map((p, idx) => (
                    <div key={idx} className="kv">
                      <span>{(p.name as L10n)[lang]}</span>
                      <span className="num">{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
                {detail.status === 'open' && (
                  <button className="btn send wide" onClick={() => onOpen(detail)}>
                    {t('rcOpenCheck')}
                  </button>
                )}
                {detail.status === 'closed' && (
                  <button className="btn send wide" onClick={() => void reprint(detail)}>
                    🧾 {t('reprint')}
                  </button>
                )}
                <button className="btn plain wide" onClick={() => void showHistory(detail)}>
                  🕘 {t('receiptHistory')}
                </button>
                {detail.status === 'closed' && can('receipt.reopen') && (
                  <button className="btn plain wide" onClick={() => void reopen(detail)}>
                    ↺ {t('reopenReceipt')}
                  </button>
                )}
                {detail.status === 'closed' && can('receipt.refund') && (
                  <button className="btn plain wide danger-text" onClick={() => void refund(detail)}>
                    ↩ {t('refund')}
                  </button>
                )}
                {detail.status === 'refunded' && <div className="rc-chip void rc-refunded">↩ {t('refunded')}</div>}
              </>
            )}
          </aside>
        </div>
      </div>

      {history && (
        <Dialog title={t('receiptHistory')} onClose={() => setHistory(null)}>
          <div className="rc-history">
            {history.length === 0 && <span className="muted">—</span>}
            {history.map((h) => (
              <div key={h.id} className={h.suspicious ? 'sus' : ''}>
                <time className="num">{clock(h.createdAt)}</time>
                <span>
                  {h.suspicious ? '⚠ ' : ''}
                  {ACTIONS[h.action]?.[lang] ?? h.action}
                  <small>{h.userName ?? '—'}</small>
                </span>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}
