import { useCallback, useEffect, useState } from 'react'
import { api, money, qtyText, type L10n, type OpenReceipt, type Receipt } from './api'
import { useApp } from './app'
import { guestReceipt, printSlips } from './print'

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
export function ReceiptsScreen({ open, onOpen, onBack }: { open: OpenReceipt[]; onOpen: (r: Receipt) => void; onBack: () => void }) {
  const { boot, t, lang, fail, toast } = useApp()
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [closed, setClosed] = useState<ClosedRow[] | null>(null)
  const [detail, setDetail] = useState<Receipt | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const loadClosed = useCallback(() => {
    api<{ receipts: ClosedRow[] }>('/pos/archive')
      .then((r) => setClosed(r.receipts))
      .catch(fail)
  }, [fail])

  useEffect(() => {
    if (tab === 'closed') loadClosed()
  }, [tab, loadClosed])

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
                    <b className={`num ${r.status === 'cancelled' ? 'rc-strike' : ''}`}>{money(r.total)}</b>
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
                    {detail.guests} 👤
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
              </>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}
