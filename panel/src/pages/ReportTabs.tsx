import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, money, type L10n } from '../api'
import { useI18n, type Key } from '../i18n'
import { dateTime, type Period } from '../period'
import { ErrorNote, Toggle } from '../ui'

const qtyText = (q: number) => (q % 1000 === 0 ? String(q / 1000) : (q / 1000).toFixed(3).replace(/0+$/, '').replace('.', ','))

/** Файл CSV с разделителем «;» и меткой кодировки — открывается в Excel двойным щелчком. */
function downloadCsv(name: string, head: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Загрузка отчёта за период; ответ на устаревший запрос не затирает свежий. */
function useReport<T>(path: string) {
  const { tErr } = useI18n()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    setData(null)
    api<T>(path)
      .then((d) => {
        if (stale) return
        setData(d)
        setError(null)
      })
      .catch((err) => !stale && setError(tErr(err instanceof ApiError ? err.code : 'internal')))
    return () => {
      stale = true
    }
  }, [path, tErr])
  return { data, error }
}

// ───────────── Товары ─────────────

type ProductRow = {
  productId: string | null
  name: L10n
  categoryId: string | null
  departmentId: string | null
  qty: number
  amount: number
  cost: number
  profit: number
  compQty: number
  receipts: number
}
type ProductsData = { rows: ProductRow[]; categories: { id: string; name: L10n }[]; departments: { id: string; name: string }[] }
type SortKey = 'name' | 'qty' | 'amount' | 'cost' | 'profit'

/** Отчёт «Товары»: что продано за период, с фильтрами по товару, категории и отделу. */
export function ProductsReport({ period }: { period: Period }) {
  const { t, lang } = useI18n()
  const { data, error } = useReport<ProductsData>(`/reports/products?from=${period.from}&to=${period.to}`)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [department, setDepartment] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'amount', desc: true })

  const catName = useMemo(() => new Map(data?.categories.map((c) => [c.id, c.name[lang]]) ?? []), [data, lang])
  const depName = useMemo(() => new Map(data?.departments.map((d) => [d.id, d.name]) ?? []), [data])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = search.trim().toLowerCase()
    const list = data.rows.filter(
      (r) =>
        (!needle || r.name.uz.toLowerCase().includes(needle) || r.name.ru.toLowerCase().includes(needle)) &&
        (!category || (category === '-' ? !r.categoryId : r.categoryId === category)) &&
        (!department || (department === '-' ? !r.departmentId : r.departmentId === department)),
    )
    const dir = sort.desc ? -1 : 1
    return [...list].sort((a, b) => (sort.key === 'name' ? a.name[lang].localeCompare(b.name[lang]) : a[sort.key] - b[sort.key]) * dir)
  }, [data, search, category, department, sort, lang])

  const total = rows.reduce((a, r) => ({ qty: a.qty + r.qty, amount: a.amount + r.amount, cost: a.cost + r.cost, profit: a.profit + r.profit }), { qty: 0, amount: 0, cost: 0, profit: 0 })
  const markup = (r: { amount: number; cost: number }) => (r.cost > 0 ? `${Math.round(((r.amount - r.cost) / r.cost) * 100)}%` : '—')

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`px-4 py-3 font-medium ${right ? 'text-right' : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="cursor-pointer uppercase tracking-wide hover:text-slate-900" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input w-56" placeholder={t('rpProduct')} aria-label={t('rpProduct')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-auto" aria-label={t('rpCategory')} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">
            {t('rpCategory')}: {t('rcAll')}
          </option>
          {data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name[lang]}
            </option>
          ))}
          <option value="-">{t('rpNoCategory')}</option>
        </select>
        <select className="input w-auto" aria-label={t('rpDepartment')} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">
            {t('rpDepartment')}: {t('rcAll')}
          </option>
          {data?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="-">{t('rpNoDepartment')}</option>
        </select>
        <button
          className="btn btn-ghost ml-auto"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `neopos-products-${period.from}_${period.to}.csv`,
              [t('rpProduct'), t('rpCategory'), t('rpDepartment'), t('rpQty'), t('rpComp'), t('rpAmount'), t('kCost'), t('kProfit'), t('rpMarkup')],
              rows.map((r) => [r.name[lang], catName.get(r.categoryId ?? '') ?? '', depName.get(r.departmentId ?? '') ?? '', qtyText(r.qty), qtyText(r.compQty), r.amount, r.cost, r.profit, markup(r)]),
            )
          }
        >
          ↓ {t('exportCsv')}
        </button>
      </div>

      <ErrorNote text={error} />
      {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                {th('name', t('rpProduct'), false)}
                <th className="px-4 py-3 font-medium uppercase tracking-wide">{t('rpCategory')}</th>
                <th className="px-4 py-3 font-medium uppercase tracking-wide">{t('rpDepartment')}</th>
                {th('qty', t('rpQty'))}
                <th className="px-4 py-3 text-right font-medium uppercase tracking-wide">{t('rpComp')}</th>
                {th('amount', t('rpAmount'))}
                {th('cost', t('kCost'))}
                {th('profit', t('kProfit'))}
                <th className="px-4 py-3 text-right font-medium uppercase tracking-wide">{t('rpMarkup')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.productId ?? r.name.uz} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{r.name[lang] || r.name.uz}</td>
                  <td className="px-4 py-2.5 text-slate-600">{catName.get(r.categoryId ?? '') ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{depName.get(r.departmentId ?? '') ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{qtyText(r.qty)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.compQty ? qtyText(r.compQty) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(r.amount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.cost ? money(r.cost) : '—'}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${r.profit < 0 ? 'text-red-600' : ''}`}>{money(r.profit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{markup(r)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    {t('emptyList')}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-3" colSpan={3}>
                    {t('rpTotal')} · {rows.length}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{qtyText(total.qty)}</td>
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums">{money(total.amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(total.cost)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(total.profit)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{markup(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  )
}

// ───────────── История ─────────────

type HistoryRow = {
  id: string
  action: string
  suspicious: boolean
  data: Record<string, unknown>
  createdAt: string
  userId: string | null
  userName: string | null
  receiptId: string | null
  receiptNumber: number | null
  tableName: string | null
}

/** Отчёт «История»: журнал действий сотрудников с фильтрами по действию, сотруднику и подозрительным. */
export function HistoryReport({ period }: { period: Period }) {
  const { t, lang } = useI18n()
  const [suspicious, setSuspicious] = useState(false)
  const { data, error } = useReport<{ total: number; rows: HistoryRow[] }>(`/reports/history?from=${period.from}&to=${period.to}&suspicious=${suspicious ? 1 : 0}`)
  const [action, setAction] = useState('')
  const [user, setUser] = useState('')
  const [number, setNumber] = useState('')

  const actionName = (a: string) => t(`act.${a}` as Key) || a
  const actions = useMemo(() => [...new Set(data?.rows.map((r) => r.action) ?? [])].sort(), [data])
  const users = useMemo(() => [...new Map(data?.rows.filter((r) => r.userId).map((r) => [r.userId!, r.userName ?? '—']) ?? [])], [data])
  const rows = useMemo(
    () => data?.rows.filter((r) => (!action || r.action === action) && (!user || r.userId === user) && (!number || String(r.receiptNumber ?? '') === number)) ?? [],
    [data, action, user, number],
  )

  /** Подробности действия простыми словами: что именно изменили. */
  function details(r: HistoryRow) {
    const d = r.data
    const name = d.name && typeof d.name === 'object' ? ((d.name as L10n)[lang] ?? '') : ''
    const sum = (v: unknown) => (typeof v === 'number' ? money(v) : '')
    switch (r.action) {
      case 'item.void':
        return [name, d.reason && typeof d.reason === 'object' ? (d.reason as L10n)[lang] : '', sum(d.total)].filter(Boolean).join(' · ')
      case 'item.price':
        return `${name}: ${sum(d.from)} → ${sum(d.to)}`
      case 'item.discount':
        return [name, d.kind === 'percent' ? `${String(d.value)}%` : '', d.amount ? `−${sum(d.amount)}` : ''].filter(Boolean).join(' · ')
      case 'item.comp':
      case 'item.uncomp':
        return [name, sum(d.total)].filter(Boolean).join(' · ')
      case 'receipt.sale_type': {
        const nm = (v: unknown) => (v && typeof v === 'object' ? ((v as L10n)[lang] ?? '—') : '—')
        return `${nm(d.from)} → ${nm(d.to)}`
      }
      case 'receipt.waiter':
      case 'receipt.move':
        return `${String(d.from ?? '—')} → ${String(d.to ?? '—')}`
      case 'receipt.discount':
        return d.kind === 'percent' ? `${String(d.value)}%` : sum(d.value)
      case 'receipt.pay':
      case 'receipt.refund':
      case 'receipt.reopen':
      case 'receipt.bill':
        return sum(d.total)
      default:
        return ''
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" aria-label={t('rhAction')} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">
            {t('rhAction')}: {t('rcAll')}
          </option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {actionName(a)}
            </option>
          ))}
        </select>
        <select className="input w-auto" aria-label={t('rhUser')} value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">
            {t('rhUser')}: {t('rcAll')}
          </option>
          {users.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input className="input w-32" inputMode="numeric" placeholder={t('rhReceipt')} aria-label={t('rhReceipt')} value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 9))} />
        <div className="min-w-56">
          <Toggle label={t('rcSuspicious')} checked={suspicious} onChange={setSuspicious} />
        </div>
        <button
          className="btn btn-ghost ml-auto"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `neopos-history-${period.from}_${period.to}.csv`,
              [t('rhTime'), t('rhUser'), t('rhAction'), t('rhReceipt'), t('rhDetails')],
              rows.map((r) => [dateTime(r.createdAt), r.userName ?? '', actionName(r.action), r.receiptNumber ?? '', details(r)]),
            )
          }
        >
          ↓ {t('exportCsv')}
        </button>
      </div>

      <ErrorNote text={error} />
      {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {data && (
        <>
          <div className="mb-2 text-sm text-slate-600">
            {t('rcFound')}: <b className="tabular-nums">{rows.length}</b>
            {data.total > data.rows.length && ` (${t('rhLimit')})`}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('rhTime')}</th>
                  <th className="px-4 py-3 font-medium">{t('rhUser')}</th>
                  <th className="px-4 py-3 font-medium">{t('rhAction')}</th>
                  <th className="px-4 py-3 font-medium">{t('rhReceipt')}</th>
                  <th className="px-4 py-3 font-medium">{t('rhDetails')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className={r.suspicious ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{dateTime(r.createdAt)}</td>
                    <td className="px-4 py-2.5">{r.userName ?? '—'}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {r.suspicious && (
                        <span className="mr-1 text-amber-600" title={t('rcSuspiciousHint')} aria-label={t('rcSuspiciousHint')}>
                          ⚠
                        </span>
                      )}
                      {actionName(r.action)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">
                      {r.receiptNumber ? `№${r.receiptNumber}` : '—'}
                      {r.tableName ? ` · ${r.tableName}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{details(r)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      {t('emptyList')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

// ───────────── Зарплата ─────────────

type SalaryRow = {
  id: string
  name: string
  roleName: string
  receipts: number
  sales: number
  service: number
  salaryFixed: number
  salarySalesBp: number
  salaryServiceBp: number
  fixed: number
  fromSales: number
  fromService: number
  total: number
}

const pct = (bp: number) => (bp ? `${String(bp / 100).replace('.', ',')}%` : '')

/** Отчёт «Зарплата»: оклад за дни периода, процент от своих продаж и от обслуживания. */
export function SalaryReport({ period }: { period: Period }) {
  const { t } = useI18n()
  const { data, error } = useReport<{ rows: SalaryRow[]; days: number }>(`/reports/salary?from=${period.from}&to=${period.to}`)
  const rows = data?.rows ?? []
  const sum = (k: 'receipts' | 'sales' | 'service' | 'fixed' | 'fromSales' | 'fromService' | 'total') => rows.reduce((a, r) => a + r[k], 0)
  const noRates = rows.length > 0 && rows.every((r) => !r.salaryFixed && !r.salarySalesBp && !r.salaryServiceBp)
  const part = (amount: number, hint: string) => (
    <td className="px-4 py-2.5 text-right tabular-nums">
      {amount ? money(amount) : '—'}
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </td>
  )

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          className="btn btn-ghost"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `neopos-salary-${period.from}_${period.to}.csv`,
              [t('slEmployee'), t('role'), t('slReceipts'), t('slSales'), t('slService'), t('slFixed'), t('slFromSales'), t('slFromService'), t('slTotal')],
              rows.map((r) => [r.name, r.roleName, r.receipts, r.sales, r.service, r.fixed, r.fromSales, r.fromService, r.total]),
            )
          }
        >
          ↓ {t('exportCsv')}
        </button>
      </div>
      <ErrorNote text={error} />
      {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {noRates && (
        <div role="note" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('slNoRates')}
        </div>
      )}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('slEmployee')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slReceipts')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slSales')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slService')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slFixed')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slFromSales')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slFromService')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('slTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">
                    {r.name}
                    <div className="text-xs font-normal text-slate-500">{r.roleName}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.receipts || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.sales ? money(r.sales) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.service ? money(r.service) : '—'}</td>
                  {part(r.fixed, r.salaryFixed ? money(r.salaryFixed) : '')}
                  {part(r.fromSales, pct(r.salarySalesBp))}
                  {part(r.fromService, pct(r.salaryServiceBp))}
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {t('emptyList')}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-3">{t('rpTotal')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{sum('receipts')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(sum('sales'))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(sum('service'))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(sum('fixed'))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(sum('fromSales'))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(sum('fromService'))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(sum('total'))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  )
}
