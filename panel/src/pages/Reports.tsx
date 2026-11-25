import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, money, type L10n } from '../api'
import { useI18n } from '../i18n'
import { dateTime, PeriodPicker, todayPeriod, type Period } from '../period'
import { ErrorNote, Segmented } from '../ui'
import { HistoryReport, ProductsReport } from './ReportTabs'

type Summary = {
  totals: {
    receipts: number
    revenue: number
    guests: number
    discounts: number
    service: number
    average: number
    cost: number
    profit: number
    noCostAmount: number
  }
  voids: { count: number; amount: number }
  cash: {
    expense: number
    income: number
    collection: number
    byCategory: { type: string; name: string | null; parent: string | null; amount: number; count: number }[]
  }
  byDay: { day: string; receipts: number; revenue: number }[]
  byHour: { hour: number; receipts: number; revenue: number }[]
  byMethod: { id: string; name: L10n; amount: number }[]
  bySaleType: { id: string; name: L10n; receipts: number; revenue: number }[]
  byWaiter: { id: string; name: string; receipts: number; revenue: number }[]
  byCategory: { id: string | null; name: L10n | null; qty: number; amount: number }[]
  byProduct: { productId: string | null; name: L10n; qty: number; amount: number }[]
}

type ShiftRow = {
  id: string
  number: number
  openedAt: string
  closedAt: string | null
  openedBy: string
  closedBy: string | null
  openingCash: number
  expectedCash: number | null
  countedCash: number | null
  receipts: number
  revenue: number
}

const qtyText = (q: number) => (q % 1000 === 0 ? String(q / 1000) : (q / 1000).toFixed(2).replace('.', ','))

/** Короткая запись крупных сумм для подписей оси: 1 250 000 → 1,25 млн */
const short = (n: number, lang: 'uz' | 'ru') =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',')} ${lang === 'ru' ? 'млн' : 'mln'}`
    : n >= 1000
      ? `${Math.round(n / 1000)} ${lang === 'ru' ? 'тыс' : 'ming'}`
      : String(n)

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

/**
 * Столбчатая диаграмма одного показателя. Один цвет: ряд один, легенда не нужна —
 * что показано, называет заголовок. Значение каждого столбца доступно по наведению и с клавиатуры.
 */
function Bars({ title, points }: { title: string; points: { label: string; full: string; value: number }[] }) {
  const { lang } = useI18n()
  const max = Math.max(1, ...points.map((p) => p.value))
  // Подписи оси — не чаще, чем поместится без наложения.
  const step = Math.max(1, Math.ceil(points.length / 8))
  return (
    <figure className="card p-4">
      <figcaption className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{title}</span>
        <span className="text-xs tabular-nums text-slate-500">max {short(max, lang)}</span>
      </figcaption>
      <div className="flex h-44 items-end gap-0.5 border-b border-slate-200" role="list">
        {points.map((p, i) => (
          <div
            key={p.label + i}
            role="listitem"
            tabIndex={0}
            aria-label={`${p.full}: ${money(p.value)}`}
            className="group relative flex h-full min-w-0 max-w-9 flex-1 cursor-default items-end outline-none"
          >
            <div
              className="w-full rounded-t bg-brand-500 transition-colors group-hover:bg-brand-700 group-focus-visible:bg-brand-700"
              style={{ height: p.value ? `max(2px, ${(p.value / max) * 100}%)` : 0 }}
            />
            <div
              className={`pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block group-focus-visible:block ${
                i < points.length / 2 ? 'left-0' : 'right-0'
              }`}
            >
              <div className="text-slate-300">{p.full}</div>
              <div className="font-semibold tabular-nums">{money(p.value)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[11px] tabular-nums text-slate-500">
        {points.map((p, i) => (
          <div key={p.label + i} className="min-w-0 max-w-9 flex-1 overflow-visible whitespace-nowrap text-center">
            {i % step === 0 ? p.label : ''}
          </div>
        ))}
      </div>
    </figure>
  )
}

/** Рейтинг: название, числа и тонкая полоска доли. Числа всегда видны — полоска лишь помогает сравнить. */
function Rank({
  title,
  rows,
  qtyLabel,
  note,
}: {
  title: string
  rows: { key: string; name: string; qty?: string; amount: number }[]
  qtyLabel?: string
  note?: ReactNode
}) {
  const { t } = useI18n()
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const max = Math.max(1, ...rows.map((r) => r.amount))
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">{t('noSales')}</div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('name')}</th>
              {qtyLabel && <th className="px-2 py-2 text-right font-medium">{qtyLabel}</th>}
              <th className="px-2 py-2 text-right font-medium">{t('rcSum')}</th>
              <th className="w-28 px-4 py-2 text-right font-medium">{t('share')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2 font-medium">{r.name}</td>
                {qtyLabel && <td className="px-2 py-2 text-right tabular-nums text-slate-600">{r.qty}</td>}
                <td className="px-2 py-2 text-right font-medium tabular-nums">{money(r.amount)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.amount / max) * 100}%` }} />
                    </div>
                    <span className="w-9 text-right text-xs tabular-nums text-slate-600">
                      {total ? Math.round((r.amount / total) * 100) : 0}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{note}</div>}
    </section>
  )
}

function useSummary(period: Period) {
  const { tErr } = useI18n()
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    api<Summary>(`/reports/summary?from=${period.from}&to=${period.to}`)
      .then((d) => {
        if (stale) return
        setData(d)
        setError(null)
      })
      .catch((err) => !stale && setError(tErr(err instanceof ApiError ? err.code : 'internal')))
    return () => {
      stale = true
    }
  }, [period, tErr])
  return { data, error }
}

/** Главная страница панели: продажи за сегодня. */
export function TodayTiles() {
  const { t } = useI18n()
  const [period] = useState(todayPeriod)
  const { data, error } = useSummary(period)
  if (error) return <ErrorNote text={error} />
  if (!data) return <div className="text-sm text-slate-500">{t('loading')}</div>
  return (
    <>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{t('todayTitle')}</h2>
        <Link to="/reports" className="text-sm font-medium text-brand-600 hover:underline">
          {t('allReports')} →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('kRevenue')} value={money(data.totals.revenue)} />
        <Kpi label={t('kReceipts')} value={String(data.totals.receipts)} />
        <Kpi label={t('kAverage')} value={money(data.totals.average)} />
        <Kpi label={t('kGuests')} value={String(data.totals.guests)} />
      </div>
    </>
  )
}

export function ReportsPage() {
  const { t, tErr, lang } = useI18n()
  const [period, setPeriod] = useState<Period>(todayPeriod)
  const [tab, setTab] = useState<'sales' | 'products' | 'shifts' | 'history'>('sales')
  const { data, error } = useSummary(period)
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null)
  const [shiftError, setShiftError] = useState<string | null>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  useEffect(() => {
    if (tab !== 'shifts') return
    let stale = false
    api<ShiftRow[]>(`/reports/shifts?from=${period.from}&to=${period.to}`)
      .then((d) => {
        if (stale) return
        setShifts(d)
        setShiftError(null)
      })
      .catch((err) => !stale && setShiftError(errText(err)))
    return () => {
      stale = true
    }
  }, [tab, period, errText])

  const oneDay = period.from === period.to

  // За один день показываем часы, за несколько — дни. Пустые дни и часы остаются на оси нулями.
  const points = useMemo(() => {
    if (!data) return []
    if (oneDay) {
      if (!data.byHour.length) return []
      const by = new Map(data.byHour.map((h) => [h.hour, h.revenue]))
      const first = Math.min(...by.keys())
      const last = Math.max(...by.keys())
      return Array.from({ length: last - first + 1 }, (_, i) => {
        const h = first + i
        return { label: String(h).padStart(2, '0'), full: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, value: by.get(h) ?? 0 }
      })
    }
    const by = new Map(data.byDay.map((d) => [d.day, d.revenue]))
    const out: { label: string; full: string; value: number }[] = []
    for (let d = new Date(`${period.from}T00:00:00Z`); d <= new Date(`${period.to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
      const iso = d.toISOString().slice(0, 10)
      const [, m, dd] = iso.split('-')
      out.push({ label: `${dd}.${m}`, full: `${dd}.${m}.${iso.slice(0, 4)}`, value: by.get(iso) ?? 0 })
    }
    return out
  }, [data, oneDay, period])

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-5 text-2xl font-semibold">{t('navReports')}</h1>
      <div className="mb-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sales', label: t('kRevenue') },
            { value: 'products', label: t('rProducts') },
            { value: 'shifts', label: t('rShifts') },
            { value: 'history', label: t('rHistory') },
          ]}
        />
      </div>

      {tab === 'sales' && (
        <>
          <ErrorNote text={error} />
          {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label={t('kRevenue')} value={money(data.totals.revenue)} />
                <Kpi label={t('kReceipts')} value={String(data.totals.receipts)} />
                <Kpi label={t('kAverage')} value={money(data.totals.average)} />
                <Kpi label={t('kGuests')} value={String(data.totals.guests)} />
                <Kpi label={t('kCost')} value={money(data.totals.cost)} />
                <Kpi
                  label={t('kProfit')}
                  value={money(data.totals.profit)}
                  hint={data.totals.revenue ? `${t('margin')}: ${Math.round((data.totals.profit / data.totals.revenue) * 100)}%` : undefined}
                />
                <Kpi label={t('kDiscounts')} value={money(data.totals.discounts)} />
                <Kpi label={t('kService')} value={money(data.totals.service)} />
                <Kpi label={t('kVoids')} value={String(data.voids.count)} hint={data.voids.count ? money(data.voids.amount) : undefined} />
              </div>

              {data.totals.noCostAmount > 0 && (
                <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  ⚠ {t('noCostWarn')} <b className="tabular-nums">{money(data.totals.noCostAmount)}</b>.{' '}
                  <Link to="/menu" className="font-medium underline">
                    {t('navMenu')} →
                  </Link>
                </div>
              )}

              {points.length > 0 ? (
                <Bars title={oneDay ? t('chByHour') : t('chByDay')} points={points} />
              ) : (
                <div className="card p-8 text-center text-sm text-slate-500">{t('noSales')}</div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Rank title={t('rByMethod')} rows={data.byMethod.map((m) => ({ key: m.id, name: m.name[lang], amount: m.amount }))} />
                <Rank
                  title={t('rBySaleType')}
                  qtyLabel={t('kReceipts')}
                  rows={data.bySaleType.map((s) => ({ key: s.id, name: s.name[lang], qty: String(s.receipts), amount: s.revenue }))}
                />
                <Rank
                  title={t('rByWaiter')}
                  qtyLabel={t('kReceipts')}
                  rows={data.byWaiter.map((w) => ({ key: w.id, name: w.name, qty: String(w.receipts), amount: w.revenue }))}
                />
                <Rank
                  title={t('rByCategory')}
                  qtyLabel={t('qty')}
                  note={t('itemsNote')}
                  rows={data.byCategory.map((c) => ({
                    key: c.id ?? 'none',
                    name: c.name?.[lang] ?? t('noCategory'),
                    qty: qtyText(c.qty),
                    amount: c.amount,
                  }))}
                />
              </div>
              <Rank
                title={t('rByProduct')}
                qtyLabel={t('qty')}
                note={t('itemsNote')}
                rows={data.byProduct.map((p, i) => ({ key: p.productId ?? `x${i}`, name: p.name[lang], qty: qtyText(p.qty), amount: p.amount }))}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Kpi label={t('cashExpense')} value={money(data.cash.expense)} />
                <Kpi label={t('cashIncome')} value={money(data.cash.income)} />
                <Kpi label={t('cashCollection')} value={money(data.cash.collection)} />
              </div>
              <Rank
                title={t('cashByCategory')}
                qtyLabel={t('opsCount')}
                rows={data.cash.byCategory
                  .filter((c) => c.type !== 'collection')
                  .map((c, i) => ({
                    key: `${c.type}-${c.parent ?? ''}-${c.name ?? ''}-${i}`,
                    name: `${c.type === 'income' ? '＋ ' : ''}${c.parent ? `${c.parent} → ` : ''}${c.name ?? t('noCategory')}`,
                    qty: String(c.count),
                    amount: c.amount,
                  }))}
              />
            </div>
          )}
        </>
      )}

      {tab === 'products' && <ProductsReport period={period} />}
      {tab === 'history' && <HistoryReport period={period} />}

      {tab === 'shifts' && (
        <>
          <ErrorNote text={shiftError} />
          {!shifts && !shiftError && <div className="text-sm text-slate-500">{t('loading')}</div>}
          {shifts && (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t('shNumber')}</th>
                    <th className="px-4 py-3 font-medium">{t('shOpened')}</th>
                    <th className="px-4 py-3 font-medium">{t('shClosed')}</th>
                    <th className="px-4 py-3 text-right font-medium">{t('kReceipts')}</th>
                    <th className="px-4 py-3 text-right font-medium">{t('kRevenue')}</th>
                    <th className="px-4 py-3 text-right font-medium">{t('shExpected')}</th>
                    <th className="px-4 py-3 text-right font-medium">{t('shCounted')}</th>
                    <th className="px-4 py-3 text-right font-medium">{t('shDiff')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shifts.map((s) => {
                    const diff = s.countedCash != null && s.expectedCash != null ? s.countedCash - s.expectedCash : null
                    return (
                      <tr key={s.id} className={diff ? 'bg-amber-50' : ''}>
                        <td className="px-4 py-3 font-medium tabular-nums">№{s.number}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-600">
                          {dateTime(s.openedAt)}
                          <div className="text-xs">{s.openedBy}</div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-600">
                          {s.closedAt ? dateTime(s.closedAt) : t('shStillOpen')}
                          <div className="text-xs">{s.closedBy ?? ''}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.receipts}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{money(s.revenue)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.expectedCash != null ? money(s.expectedCash) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.countedCash != null ? money(s.countedCash) : '—'}</td>
                        <td className={`px-4 py-3 text-right font-medium tabular-nums ${diff ? 'text-amber-700' : ''}`}>
                          {diff == null ? '—' : `${diff > 0 ? '+' : ''}${money(diff)}`}
                        </td>
                      </tr>
                    )
                  })}
                  {shifts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                        {t('emptyList')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
