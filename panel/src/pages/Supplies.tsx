import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError, money, type L10n } from '../api'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { ErrorNote, Field, Modal, Segmented } from '../ui'

type SupplyRow = { id: string; number: number; supplier: string; note: string | null; total: number; date: string; userName: string | null; positions: number }
type SupplyDetail = SupplyRow & { items: { id: string; productId: string; name: L10n; qty: number; cost: number; total: number }[] }
type StockProduct = { id: string; name: L10n; category: L10n | null; price: number; cost: number; stock: number; trackStock: boolean }
type Stock = { products: StockProduct[]; value: number }

const W = {
  title: { uz: 'Tovar kirimi', ru: 'Приход товаров' },
  tabSupplies: { uz: 'Kirimlar', ru: 'Приходы' },
  tabStock: { uz: 'Qoldiqlar', ru: 'Остатки' },
  create: { uz: 'Kirim qo‘shish', ru: 'Добавить приход' },
  hint: {
    uz: 'Donali tovarlar uchun: kirim qoldiqni oshiradi va tannarxni o‘rtacha hisobda yangilaydi. Sotilganda qoldiq kamayadi.',
    ru: 'Для штучных товаров: приход увеличивает остаток и обновляет себестоимость как среднюю. При продаже остаток уменьшается.',
  },
  number: { uz: '№', ru: '№' },
  date: { uz: 'Sana', ru: 'Дата' },
  supplier: { uz: 'Yetkazib beruvchi', ru: 'Поставщик' },
  positions: { uz: 'Pozitsiyalar', ru: 'Позиций' },
  sum: { uz: 'Summa', ru: 'Сумма' },
  who: { uz: 'Kim kiritdi', ru: 'Кто внёс' },
  empty: { uz: 'Kirimlar hali yo‘q', ru: 'Приходов пока нет' },
  product: { uz: 'Tovar', ru: 'Товар' },
  qty: { uz: 'Soni, dona', ru: 'Кол-во, шт' },
  cost: { uz: 'Xarid narxi, so‘m', ru: 'Цена закупки, сум' },
  lineTotal: { uz: 'Jami', ru: 'Итого' },
  addRow: { uz: 'Qator qo‘shish', ru: 'Добавить строку' },
  choose: { uz: 'Tovarni tanlang', ru: 'Выберите товар' },
  note: { uz: 'Izoh', ru: 'Примечание' },
  total: { uz: 'Hujjat summasi', ru: 'Сумма накладной' },
  noProducts: { uz: 'Donali tovarlar yo‘q. Avval menyuga tovar qo‘shing.', ru: 'Штучных товаров нет. Сначала добавьте товар в меню.' },
  stock: { uz: 'Qoldiq', ru: 'Остаток' },
  price: { uz: 'Sotuv narxi', ru: 'Цена продажи' },
  costCol: { uz: 'Tannarx', ru: 'Себестоимость' },
  margin: { uz: 'Ustama', ru: 'Наценка' },
  stockValue: { uz: 'Qoldiq qiymati', ru: 'Стоимость остатка' },
  allValue: { uz: 'Qoldiqlar tannarx bo‘yicha', ru: 'Остатки по себестоимости' },
  noTrack: { uz: 'kirim bo‘lmagan', ru: 'прихода не было' },
  category: { uz: 'Kategoriya', ru: 'Категория' },
  confirmDelete: {
    uz: 'Kirim o‘chirilsinmi? Qoldiq shu miqdorga kamayadi, tannarx o‘zgarmaydi.',
    ru: 'Удалить приход? Остаток уменьшится на это количество, себестоимость не изменится.',
  },
  'err.supply_only_pieces': { uz: 'Kirim faqat donali tovarlar uchun', ru: 'Приход ведётся только для штучных товаров' },
} as const

const TZ = 'Asia/Tashkent'
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
const pcs = (q: number) => (q % 1000 === 0 ? String(q / 1000) : (q / 1000).toFixed(3).replace(/0+$/, '').replace('.', ','))

/** «Приход товаров»: накладные от поставщиков и остатки штучных товаров с себестоимостью. */
export function SuppliesPage() {
  const { t, tErr, lang } = useI18n()
  const { can } = useSession()
  const [tab, setTab] = useState<'supplies' | 'stock'>('supplies')
  const [rows, setRows] = useState<SupplyRow[] | null>(null)
  const [stock, setStock] = useState<Stock | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<SupplyDetail | null>(null)
  const canEdit = can('menu.edit')

  const errText = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'internal'
      const key = `err.${code}` as keyof typeof W
      return key in W ? W[key][lang] : tErr(code)
    },
    [tErr, lang],
  )

  const load = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([api<SupplyRow[]>('/supplies'), api<Stock>('/stock')])
      setRows(s)
      setStock(st)
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  async function open(id: string) {
    try {
      setDetail(await api<SupplyDetail>(`/supplies/${id}`))
    } catch (err) {
      setError(errText(err))
    }
  }

  async function remove(s: SupplyDetail) {
    if (!window.confirm(`№${s.number}\n\n${W.confirmDelete[lang]}`)) return
    try {
      await api(`/supplies/${s.id}`, { method: 'DELETE' })
      setDetail(null)
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  const tracked = useMemo(() => (stock?.products ?? []).filter((p) => p.trackStock), [stock])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{W.title[lang]}</h1>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + {W.create[lang]}
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-slate-500">{W.hint[lang]}</p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'supplies', label: W.tabSupplies[lang] },
            { value: 'stock', label: W.tabStock[lang] },
          ]}
        />
        {stock && (
          <div className="text-sm text-slate-600">
            {W.allValue[lang]}: <b className="tabular-nums text-slate-900">{money(stock.value)}</b>
          </div>
        )}
      </div>

      <ErrorNote text={error} />
      {!rows && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}

      {tab === 'supplies' && rows && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{W.number[lang]}</th>
                <th className="px-4 py-3">{W.date[lang]}</th>
                <th className="px-4 py-3">{W.supplier[lang]}</th>
                <th className="px-4 py-3 text-right">{W.positions[lang]}</th>
                <th className="px-4 py-3 text-right">{W.sum[lang]}</th>
                <th className="px-4 py-3">{W.who[lang]}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    {W.empty[lang]}
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => void open(s.id)}>
                  <td className="px-4 py-3 font-medium text-brand-600">{s.number}</td>
                  <td className="px-4 py-3">{day(s.date)}</td>
                  <td className="px-4 py-3">{s.supplier || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.positions}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{money(s.total)}</td>
                  <td className="px-4 py-3 text-slate-600">{s.userName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stock' && stock && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{W.product[lang]}</th>
                <th className="px-4 py-3">{W.category[lang]}</th>
                <th className="px-4 py-3 text-right">{W.stock[lang]}</th>
                <th className="px-4 py-3 text-right">{W.costCol[lang]}</th>
                <th className="px-4 py-3 text-right">{W.price[lang]}</th>
                <th className="px-4 py-3 text-right">{W.margin[lang]}</th>
                <th className="px-4 py-3 text-right">{W.stockValue[lang]}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tracked.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {W.empty[lang]}
                  </td>
                </tr>
              )}
              {tracked.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.name[lang]}</td>
                  <td className="px-4 py-3 text-slate-600">{p.category?.[lang] ?? '—'}</td>
                  <td className={`px-4 py-3 text-right font-medium tabular-nums ${p.stock <= 0 ? 'text-red-600' : ''}`}>{pcs(p.stock)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(p.cost)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(p.price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{p.cost > 0 ? `${Math.round(((p.price - p.cost) / p.cost) * 100)}%` : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(Math.max(0, Math.round((p.stock * p.cost) / 1000)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && stock && (
        <SupplyForm
          products={stock.products}
          errText={errText}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}

      {detail && (
        <Modal title={`${W.title[lang]} №${detail.number} · ${day(detail.date)}`} onClose={() => setDetail(null)} wide>
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              {W.supplier[lang]}: <b className="text-slate-900">{detail.supplier || '—'}</b>
              {detail.note && <span className="ml-3">{detail.note}</span>}
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {detail.items.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{i.name[lang]}</span>
                  <span className="tabular-nums text-slate-600">
                    {pcs(i.qty)} × {money(i.cost)}
                  </span>
                  <b className="w-28 text-right tabular-nums">{money(i.total)}</b>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2 font-semibold">
                <span>{W.total[lang]}</span>
                <span className="tabular-nums">{money(detail.total)}</span>
              </div>
            </div>
            <div className="flex justify-between gap-2">
              {canEdit ? (
                <button className="btn btn-danger" onClick={() => void remove(detail)}>
                  {t('delete')}
                </button>
              ) : (
                <span />
              )}
              <button className="btn btn-ghost" onClick={() => setDetail(null)}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

type Line = { key: number; productId: string; qty: string; cost: string }

function SupplyForm({
  products,
  errText,
  onClose,
  onSaved,
}: {
  products: StockProduct[]
  errText: (err: unknown) => string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, lang } = useI18n()
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: '', qty: '', cost: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const digits = (v: string, max = 9) => v.replace(/[^0-9]/g, '').slice(0, max)
  const lineTotal = (l: Line) => (Number(l.qty) || 0) * (Number(l.cost) || 0)
  const total = lines.reduce((a, l) => a + lineTotal(l), 0)
  const ready = lines.filter((l) => l.productId && Number(l.qty) > 0 && l.cost !== '')
  const valid = ready.length > 0 && ready.length === lines.filter((l) => l.productId || l.qty || l.cost).length

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await api('/supplies', {
        method: 'POST',
        body: { supplier, note: note || null, items: ready.map((l) => ({ productId: l.productId, qty: Number(l.qty) * 1000, cost: Number(l.cost) })) },
      })
      await onSaved()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={W.create[lang]} onClose={onClose} wide>
      {products.length === 0 ? (
        <div className="text-sm text-slate-600">{W.noProducts[lang]}</div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={W.supplier[lang]}>
              <input className="input" maxLength={120} autoFocus value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </Field>
            <Field label={W.note[lang]}>
              <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="hidden gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[minmax(0,1fr)_110px_150px_120px_32px]">
              <span>{W.product[lang]}</span>
              <span>{W.qty[lang]}</span>
              <span>{W.cost[lang]}</span>
              <span className="text-right">{W.lineTotal[lang]}</span>
              <span />
            </div>
            {lines.map((l) => (
              <div key={l.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_150px_120px_32px] sm:items-center">
                <select
                  className="input"
                  aria-label={W.product[lang]}
                  value={l.productId}
                  onChange={(e) => {
                    const p = byId.get(e.target.value)
                    // Подставляем последнюю себестоимость: чаще всего цена закупки та же.
                    set(l.key, { productId: e.target.value, cost: l.cost || (p && p.cost > 0 ? String(p.cost) : '') })
                  }}
                >
                  <option value="">{W.choose[lang]}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name[lang]}
                      {p.trackStock ? ` · ${pcs(p.stock)}` : ''}
                    </option>
                  ))}
                </select>
                <input className="input" inputMode="numeric" placeholder={W.qty[lang]} aria-label={W.qty[lang]} value={l.qty} onChange={(e) => set(l.key, { qty: digits(e.target.value, 6) })} />
                <input className="input" inputMode="numeric" placeholder={W.cost[lang]} aria-label={W.cost[lang]} value={l.cost} onChange={(e) => set(l.key, { cost: digits(e.target.value) })} />
                <div className="text-right font-medium tabular-nums">{money(lineTotal(l))}</div>
                <button
                  type="button"
                  className="cursor-pointer text-lg text-slate-400 hover:text-red-600"
                  aria-label={t('delete')}
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
              onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, productId: '', qty: '', cost: '' }])}
            >
              + {W.addRow[lang]}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 font-semibold">
            <span>{W.total[lang]}</span>
            <span className="tabular-nums">{money(total)}</span>
          </div>
          <ErrorNote text={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t('cancel')}
            </button>
            <button className="btn btn-primary" disabled={busy || !valid}>
              {t('save')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
