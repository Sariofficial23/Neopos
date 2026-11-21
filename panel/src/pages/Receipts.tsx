import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, money, type L10n } from '../api'
import { useI18n, type Key } from '../i18n'
import { dateTime, PeriodPicker, timeOnly, todayPeriod, type Period } from '../period'
import { Badge, ErrorNote, Modal, Toggle } from '../ui'

type Status = 'open' | 'closed' | 'cancelled'

type Row = {
  id: string
  number: number
  status: Status
  tableName: string | null
  saleType: L10n | null
  waiterName: string | null
  guests: number
  discountAmount: number
  total: number
  suspicious: boolean
  openedAt: string
  closedAt: string | null
  payments: { name: L10n; amount: number }[]
}

type Detail = Row & {
  comment: string | null
  subtotal: number
  discountKind: string | null
  discountValue: number
  serviceBp: number
  serviceAmount: number
  items: { id: string; name: L10n; price: number; qty: number; total: number; comment: string | null; voided: boolean; reason: L10n | null }[]
  history: { id: string; action: string; suspicious: boolean; data: Record<string, unknown>; createdAt: string; userName: string | null }[]
}

const STATUS_KEY: Record<Status, Key> = { open: 'stOpen', closed: 'stClosed', cancelled: 'stCancelled' }
const STATUS_TONE: Record<Status, 'green' | 'slate' | 'brand'> = { open: 'brand', closed: 'green', cancelled: 'slate' }
const qtyText = (q: number) => (q % 1000 === 0 ? String(q / 1000) : (q / 1000).toFixed(3).replace(/0+$/, '').replace('.', ','))

export function ReceiptsPage() {
  const { t, tErr, lang } = useI18n()
  const [period, setPeriod] = useState<Period>(todayPeriod)
  const [status, setStatus] = useState<'all' | Status>('all')
  const [suspicious, setSuspicious] = useState(false)
  const [number, setNumber] = useState('')
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  useEffect(() => {
    let stale = false
    const qs = new URLSearchParams({ from: period.from, to: period.to, status, suspicious: suspicious ? '1' : '0' })
    if (number) qs.set('number', number)
    api<{ total: number; rows: Row[] }>(`/receipts?${qs}`)
      .then((d) => {
        if (stale) return
        setData(d)
        setError(null)
      })
      .catch((err) => !stale && setError(errText(err)))
    // Быстрая смена фильтров: ответ на устаревший запрос не должен затирать свежий.
    return () => {
      stale = true
    }
  }, [period, status, suspicious, number, errText])

  const place = (r: Row) => (r.tableName ? `${t('table')} ${r.tableName}` : (r.saleType?.[lang] ?? '—'))
  const payText = (r: Row) => r.payments.map((p) => p.name[lang]).join(' + ') || '—'

  async function open(id: string) {
    try {
      setDetail(await api<Detail>(`/receipts/${id}`))
    } catch (err) {
      setError(errText(err))
    }
  }

  /** CSV с разделителем «;» и меткой кодировки — открывается в Excel двойным щелчком. */
  function exportCsv() {
    if (!data) return
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const head = [t('rcNumber'), t('rcOpened'), t('rcClosed'), t('rcPlace'), t('rcWaiter'), t('rcGuests'), t('rcDiscount'), t('rcSum'), t('rcPayment'), t('status')]
    const lines = data.rows.map((r) =>
      [r.number, dateTime(r.openedAt), dateTime(r.closedAt), place(r), r.waiterName ?? '', r.guests, r.discountAmount, r.total, payText(r), t(STATUS_KEY[r.status])]
        .map(cell)
        .join(';'),
    )
    const blob = new Blob(['﻿' + [head.map(cell).join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `neopos-receipts-${period.from}_${period.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const sum = data?.rows.filter((r) => r.status === 'closed').reduce((s, r) => s + r.total, 0) ?? 0

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('navReceipts')}</h1>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!data?.rows.length}>
          ↓ {t('exportCsv')}
        </button>
      </div>

      <div className="mb-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value as 'all' | Status)}>
          <option value="all">{t('rcAll')}</option>
          <option value="closed">{t('stClosed')}</option>
          <option value="open">{t('stOpen')}</option>
          <option value="cancelled">{t('stCancelled')}</option>
        </select>
        <input
          className="input w-32"
          inputMode="numeric"
          placeholder={t('rcNumber')}
          aria-label={t('rcNumber')}
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
        />
        <div className="min-w-56">
          <Toggle label={t('rcSuspicious')} checked={suspicious} onChange={setSuspicious} />
        </div>
      </div>

      <ErrorNote text={error} />
      {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}

      {data && (
        <>
          <div className="mb-2 text-sm text-slate-600">
            {t('rcFound')}: <b className="tabular-nums">{data.total}</b>
            {data.total > data.rows.length && ` (${t('rcShown')})`} · {t('kRevenue')}: <b className="tabular-nums">{money(sum)}</b>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">№</th>
                  <th className="px-4 py-3 font-medium">{t('rcOpened')}</th>
                  <th className="px-4 py-3 font-medium">{t('rcPlace')}</th>
                  <th className="px-4 py-3 font-medium">{t('rcWaiter')}</th>
                  <th className="px-4 py-3 font-medium">{t('rcPayment')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('rcSum')}</th>
                  <th className="px-4 py-3 font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => void open(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && void open(r.id)}
                    className={`cursor-pointer outline-none hover:bg-slate-50 focus-visible:bg-brand-50 ${r.suspicious ? 'bg-amber-50 hover:bg-amber-100' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {r.suspicious && (
                        <span className="mr-1 text-amber-600" title={t('rcSuspiciousHint')} aria-label={t('rcSuspiciousHint')}>
                          ⚠
                        </span>
                      )}
                      {r.number}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{dateTime(r.openedAt)}</td>
                    <td className="px-4 py-3">{place(r)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.waiterName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{payText(r)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{money(r.total)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_KEY[r.status])}</Badge>
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      {t('emptyList')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail && (
        <Modal wide title={`${t('rcNumber')}${detail.number} · ${place(detail)}`} onClose={() => setDetail(null)}>
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-600">
              <Badge tone={STATUS_TONE[detail.status]}>{t(STATUS_KEY[detail.status])}</Badge>
              <span>
                {t('rcWaiter')}: <b className="text-slate-900">{detail.waiterName ?? '—'}</b>
              </span>
              <span>
                {t('rcGuests')}: <b className="text-slate-900">{detail.guests}</b>
              </span>
              <span className="tabular-nums">
                {dateTime(detail.openedAt)} → {dateTime(detail.closedAt)}
              </span>
            </div>
            {detail.comment && <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">💬 {detail.comment}</div>}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('rcItems')}</h3>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {detail.items.map((i) => (
                  <div key={i.id} className={`flex items-baseline justify-between gap-3 px-3 py-2 ${i.voided ? 'bg-amber-50' : ''}`}>
                    <div className="min-w-0">
                      <span className={i.voided ? 'text-slate-500 line-through' : 'font-medium'}>{i.name[lang]}</span>
                      <span className="ml-2 tabular-nums text-slate-500">
                        {qtyText(i.qty)} × {money(i.price)}
                      </span>
                      {i.voided && (
                        <span className="ml-2 text-xs font-medium text-amber-700">
                          {t('rcVoided')}
                          {i.reason ? `: ${i.reason[lang]}` : ''}
                        </span>
                      )}
                      {i.comment && <div className="text-xs text-slate-500">{i.comment}</div>}
                    </div>
                    <span className={`tabular-nums ${i.voided ? 'text-slate-400 line-through' : 'font-medium'}`}>{money(i.total)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 text-right tabular-nums">
                {(detail.discountAmount > 0 || detail.serviceAmount > 0) && (
                  <div className="text-slate-600">
                    {t('rcSubtotal')}: {money(detail.subtotal)}
                  </div>
                )}
                {detail.discountAmount > 0 && (
                  <div className="text-slate-600">
                    {t('rcDiscount')}
                    {detail.discountKind === 'percent' ? ` ${detail.discountValue}%` : ''}: −{money(detail.discountAmount)}
                  </div>
                )}
                {detail.serviceAmount > 0 && (
                  <div className="text-slate-600">
                    {t('rcService')} {detail.serviceBp / 100}%: {money(detail.serviceAmount)}
                  </div>
                )}
                <div className="text-lg font-bold">{money(detail.total)}</div>
                {detail.payments.map((p, i) => (
                  <div key={i} className="text-slate-600">
                    {p.name[lang]}: {money(p.amount)}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('rcHistory')}</h3>
              <ol className="space-y-1.5">
                {detail.history.map((h) => {
                  const key = `act.${h.action}` as Key
                  return (
                    <li key={h.id} className={`flex items-baseline gap-3 rounded-lg px-3 py-1.5 ${h.suspicious ? 'bg-amber-50' : ''}`}>
                      <span className="w-12 shrink-0 tabular-nums text-slate-500">{timeOnly(h.createdAt)}</span>
                      <span className="min-w-0 flex-1">
                        {h.suspicious && <span className="mr-1 text-amber-600">⚠</span>}
                        {t(key) || h.action}
                        {h.action === 'item.void' && h.data.name ? ` — ${(h.data.name as L10n)[lang]}` : ''}
                      </span>
                      <span className="shrink-0 text-slate-500">{h.userName ?? ''}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
          </div>
        </Modal>
      )}
    </div>
  )
}
