import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, money, type L10n } from '../api'
import { useI18n, type Key } from '../i18n'
import { dateTime, type Period } from '../period'
import { ErrorNote } from '../ui'
import { Kpi } from './Reports'

type Kind = 'void_after_bill' | 'void' | 'refund' | 'reopen' | 'price_down' | 'discount' | 'comp' | 'unlock' | 'cash_diff' | 'cancel' | 'unpaid' | 'service_down'
type UserRow = {
  userId: string | null
  name: string
  receipts: number
  revenue: number
  counts: Record<Kind, number>
  amounts: Record<Kind, number>
  score: number
  outlier: boolean
  level: 'high' | 'medium' | 'low'
}
type Case = {
  id: string
  kind: Kind
  at: string
  userId: string | null
  userName: string | null
  receiptNumber: number | null
  tableName: string | null
  amount: number
  weight: number
  data: Record<string, unknown>
}
type Data = { byUser: UserRow[]; cases: Case[]; totalCases: number; totals: { voidAfterBill: number; refunds: number; comps: number; high: number } }

/** Столбцы таблицы по сотрудникам — от самого опасного к менее опасному. */
const COLS: Kind[] = ['void_after_bill', 'unpaid', 'refund', 'reopen', 'price_down', 'discount', 'comp', 'cash_diff', 'void']
const LEVEL_CLASS = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-800', low: 'bg-slate-100 text-slate-600' } as const

/** Отчёт «Подозрительные действия»: кто из сотрудников и что именно делает чаще остальных. */
export function SuspiciousReport({ period }: { period: Period }) {
  const { t, tErr, lang } = useI18n()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind | ''>('')

  useEffect(() => {
    let stale = false
    setData(null)
    api<Data>(`/reports/suspicious?from=${period.from}&to=${period.to}`)
      .then((d) => {
        if (stale) return
        setData(d)
        setError(null)
        setUser(null)
      })
      .catch((err) => !stale && setError(tErr(err instanceof ApiError ? err.code : 'internal')))
    return () => {
      stale = true
    }
  }, [period, tErr])

  const cases = useMemo(() => data?.cases.filter((c) => (user === null || (c.userId ?? '') === user) && (!kind || c.kind === kind)) ?? [], [data, user, kind])

  /** Что произошло — простыми словами, с названием позиции и цифрами. */
  function what(c: Case) {
    const d = c.data
    const name = d.name && typeof d.name === 'object' ? ((d.name as L10n)[lang] ?? '') : ''
    const reason = d.reason && typeof d.reason === 'object' ? ((d.reason as L10n)[lang] ?? '') : ''
    const num = (v: unknown) => (typeof v === 'number' ? money(v) : '')
    switch (c.kind) {
      case 'void_after_bill':
      case 'void':
        return [name, reason].filter(Boolean).join(' · ')
      case 'price_down':
        return `${name}: ${num(d.from)} → ${num(d.to)}`
      case 'discount':
        return [name, d.kind === 'percent' ? `${String(d.value)}%` : ''].filter(Boolean).join(' · ')
      case 'comp':
        return name
      case 'service_down':
        return `${String(d.from)}% → ${String(d.to)}%`
      case 'cash_diff':
        return `${t('suCashExpected')} ${num(d.expectedCash)}, ${t('suCashCounted')} ${num(d.countedCash)}`
      default:
        return ''
    }
  }

  if (error) return <ErrorNote text={error} />
  if (!data) return <div className="text-sm text-slate-500">{t('loading')}</div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('suHint')}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('suTotHigh')} value={String(data.totals.high)} />
        <Kpi label={t('suTotVoid')} value={money(data.totals.voidAfterBill)} />
        <Kpi label={t('suTotRefund')} value={money(data.totals.refunds)} />
        <Kpi label={t('suTotComp')} value={money(data.totals.comps)} />
      </div>

      {data.byUser.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">{t('suClean')}</div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('suEmployee')}</th>
                  <th className="px-3 py-3 text-right font-medium">{t('suReceipts')}</th>
                  {COLS.map((k) => (
                    <th key={k} className="px-3 py-3 text-right font-medium">
                      {t(`suKind.${k}` as Key)}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-medium">{t('suScore')}</th>
                  <th className="px-4 py-3 font-medium">{t('suRisk')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byUser.map((u) => {
                  const key = u.userId ?? ''
                  const on = user === key
                  return (
                    <tr
                      key={key}
                      tabIndex={0}
                      onClick={() => setUser(on ? null : key)}
                      onKeyDown={(e) => e.key === 'Enter' && setUser(on ? null : key)}
                      className={`cursor-pointer outline-none hover:bg-slate-50 focus-visible:bg-brand-50 ${on ? 'bg-brand-50' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-medium">
                        {u.name}
                        {u.outlier && <div className="text-xs font-normal text-red-600">{t('suOutlier')}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{u.receipts || '—'}</td>
                      {COLS.map((k) => (
                        <td key={k} className={`px-3 py-2.5 text-right tabular-nums ${u.counts[k] ? '' : 'text-slate-300'}`}>
                          {u.counts[k] || '—'}
                          {u.counts[k] > 0 && u.amounts[k] > 0 && <div className="text-xs text-slate-500">{money(u.amounts[k])}</div>}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{u.score}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${LEVEL_CLASS[u.level]}`}>{t(`suLevel.${u.level}` as Key)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-2 font-semibold">
              {t('suCases')} · <span className="tabular-nums">{cases.length}</span>
            </h2>
            <select className="input w-auto" aria-label={t('suEmployee')} value={user ?? '*'} onChange={(e) => setUser(e.target.value === '*' ? null : e.target.value)}>
              <option value="*">{t('suAll')}</option>
              {data.byUser.map((u) => (
                <option key={u.userId ?? ''} value={u.userId ?? ''}>
                  {u.name}
                </option>
              ))}
            </select>
            <select className="input w-auto" aria-label={t('suWhat')} value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
              <option value="">
                {t('suWhat')}: {t('rcAll')}
              </option>
              {[...COLS, 'unlock' as Kind].map((k) => (
                <option key={k} value={k}>
                  {t(`suKind.${k}` as Key)}
                </option>
              ))}
            </select>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('rhTime')}</th>
                  <th className="px-4 py-3 font-medium">{t('suEmployee')}</th>
                  <th className="px-4 py-3 font-medium">{t('suWhat')}</th>
                  <th className="px-4 py-3 font-medium">{t('rhReceipt')}</th>
                  <th className="px-4 py-3 font-medium">{t('rhDetails')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('suAmount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => (
                  <tr key={c.id + c.kind} className={c.weight >= 4 ? 'bg-red-50/60' : c.weight >= 3 ? 'bg-amber-50/60' : ''}>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{dateTime(c.at)}</td>
                    <td className="px-4 py-2.5">{c.userName ?? '—'}</td>
                    <td className="px-4 py-2.5 font-medium">{t(`suKind.${c.kind}` as Key)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">
                      {c.receiptNumber ? `№${c.receiptNumber}` : '—'}
                      {c.tableName ? ` · ${c.tableName}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{what(c)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.amount ? money(Math.abs(c.amount)) : '—'}</td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      {t('emptyList')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
