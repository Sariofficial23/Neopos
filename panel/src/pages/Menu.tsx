import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError, money, type Category, type Department, type L10n, type Product } from '../api'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { ErrorNote, Field, Modal, Segmented, Switch, TILE_COLORS, Toggle } from '../ui'

type Tab = 'products' | 'categories' | 'departments'

type ProductDraft = Omit<Product, 'id' | 'price' | 'cost' | 'sort'> & { id?: string; price: string; cost: string }
type CategoryDraft = { id?: string; name: L10n; color: string; active: boolean }
type DepartmentDraft = { id?: string; name: string; printer: string }

/** Наценка в процентах к себестоимости: (цена − себестоимость) / себестоимость */
const markup = (price: number, cost: number) => Math.round(((price - cost) / cost) * 100)

/** Прибыль с одной единицы и наценка — считаются сразу при вводе цены и себестоимости. */
function ProfitBox({ price, cost }: { price: number; cost: number }) {
  const { t } = useI18n()
  const profit = price - cost
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <div className="text-xs font-medium text-slate-500">{t('unitProfit')}</div>
      {cost > 0 && price > 0 ? (
        <>
          <div className={`text-lg font-bold tabular-nums ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(profit)}</div>
          <div className="text-xs tabular-nums text-slate-600">
            {t('markup')}: {markup(price, cost)}% · {t('margin')}: {Math.round((profit / price) * 100)}%
          </div>
        </>
      ) : (
        <div className="mt-1 text-xs text-slate-500">{t('costEmpty')}</div>
      )}
    </div>
  )
}

export function MenuPage() {
  const { t, tErr, lang } = useI18n()
  const { can } = useSession()
  const canEdit = can('menu.edit')

  const [tab, setTab] = useState<Tab>('products')
  const [products, setProducts] = useState<Product[] | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [pageError, setPageError] = useState<string | null>(null)

  const [pDraft, setPDraft] = useState<ProductDraft | null>(null)
  const [cDraft, setCDraft] = useState<CategoryDraft | null>(null)
  const [dDraft, setDDraft] = useState<DepartmentDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      const [p, c, d] = await Promise.all([
        api<Product[]>('/products'),
        api<Category[]>('/categories'),
        api<Department[]>('/departments'),
      ])
      setProducts(p)
      setCategories(c)
      setDepartments(d)
      setPageError(null)
    } catch (err) {
      setPageError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Товары идут группами по категориям, в том же порядке, что и плитки на кассе.
    const order = new Map(categories.map((c, i) => [c.id, i]))
    const rank = (p: Product) => (p.categoryId ? (order.get(p.categoryId) ?? 9998) : 9999)
    const sorted = [...(products ?? [])].sort((a, b) => rank(a) - rank(b) || a.sort - b.sort)
    return sorted.filter((p) => {
      if (filter === 'none' && p.categoryId) return false
      if (filter !== 'all' && filter !== 'none' && p.categoryId !== filter) return false
      if (!q) return true
      return (
        p.name.uz.toLowerCase().includes(q) || p.name.ru.toLowerCase().includes(q) || (p.barcode ?? '').includes(q)
      )
    })
  }, [products, categories, filter, query])

  /** Общая обёртка для сохранения и удаления: блокирует кнопки, показывает ошибку, перечитывает список. */
  async function run(action: () => Promise<unknown>, close: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      close()
      await load()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  // ───── Товары ─────

  function newProduct() {
    setError(null)
    setPDraft({
      name: { uz: '', ru: '' },
      categoryId: filter !== 'all' && filter !== 'none' ? filter : null,
      departmentId: departments[0]?.id ?? null,
      price: '',
      cost: '',
      barcode: '',
      unit: 'pcs',
      byWeight: false,
      favorite: false,
      stopped: false,
      active: true,
    })
  }

  function saveProduct(e: FormEvent) {
    e.preventDefault()
    if (!pDraft) return
    const { id, price, cost, ...rest } = pDraft
    const body = { ...rest, price: Number(price) || 0, cost: Number(cost) || 0, barcode: rest.barcode || null }
    void run(
      () => (id ? api(`/products/${id}`, { method: 'PATCH', body }) : api('/products', { method: 'POST', body })),
      () => setPDraft(null),
    )
  }

  async function flag(p: Product, patch: Partial<Pick<Product, 'stopped' | 'active' | 'favorite'>>) {
    // Сразу показываем новое состояние, при ошибке возвращаем список с сервера.
    setProducts((list) => list?.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) ?? null)
    try {
      await api(`/products/${p.id}/flags`, { method: 'POST', body: patch })
    } catch (err) {
      setPageError(errText(err))
      await load()
    }
  }

  // ───── Категории и отделы ─────

  function saveCategory(e: FormEvent) {
    e.preventDefault()
    if (!cDraft) return
    const { id, ...body } = cDraft
    void run(
      () => (id ? api(`/categories/${id}`, { method: 'PATCH', body }) : api('/categories', { method: 'POST', body })),
      () => setCDraft(null),
    )
  }

  function saveDepartment(e: FormEvent) {
    e.preventDefault()
    if (!dDraft) return
    const body = { name: dDraft.name, printer: dDraft.printer || null }
    void run(
      () =>
        dDraft.id
          ? api(`/departments/${dDraft.id}`, { method: 'PATCH', body })
          : api('/departments', { method: 'POST', body }),
      () => setDDraft(null),
    )
  }

  const remove = (path: string, close: () => void) => {
    if (window.confirm(t('confirmDelete'))) void run(() => api(path, { method: 'DELETE' }), close)
  }

  const addLabel = tab === 'products' ? t('addProduct') : tab === 'categories' ? t('addCategory') : t('addDepartment')
  const onAdd = () => {
    setError(null)
    if (tab === 'products') newProduct()
    else if (tab === 'categories') setCDraft({ name: { uz: '', ru: '' }, color: TILE_COLORS[categories.length % TILE_COLORS.length], active: true })
    else setDDraft({ name: '', printer: '' })
  }

  const formFooter = (onDelete: (() => void) | null, onCancel: () => void) => (
    <div className="flex items-center justify-between gap-3 pt-1">
      {onDelete ? (
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>
          {t('delete')}
        </button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {t('save')}
        </button>
      </div>
    </div>
  )

  const nameFields = (name: L10n, onChange: (n: L10n) => void) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('nameUz')}>
        <input
          className="input"
          autoFocus
          required={!name.ru}
          value={name.uz}
          onChange={(e) => onChange({ ...name, uz: e.target.value })}
        />
      </Field>
      <Field label={t('nameRu')} hint={t('nameOneEnough')}>
        <input
          className="input"
          required={!name.uz}
          value={name.ru}
          onChange={(e) => onChange({ ...name, ru: e.target.value })}
        />
      </Field>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('navMenu')}</h1>
        {canEdit && (
          <button className="btn btn-primary" onClick={onAdd}>
            + {addLabel}
          </button>
        )}
      </div>

      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'products', label: t('tabProducts') },
            { value: 'categories', label: t('tabCategories') },
            { value: 'departments', label: t('tabDepartments') },
          ]}
        />
      </div>
      <ErrorNote text={pageError} />
      {!products && !pageError && <div className="text-sm text-slate-500">{t('loading')}</div>}

      {/* ───── Товары ───── */}
      {products && tab === 'products' && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <select className="input max-w-56" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('category')}>
              <option value="all">{t('allCategories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name[lang]}
                </option>
              ))}
              <option value="none">{t('noCategory')}</option>
            </select>
            <input
              className="input max-w-64"
              type="search"
              placeholder={t('search')}
              aria-label={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('name')}</th>
                  <th className="px-4 py-3 font-medium">{t('category')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('price')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('cost')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('markup')}</th>
                  <th className="px-4 py-3 text-center font-medium">{t('onSale')}</th>
                  <th className="px-4 py-3 text-center font-medium">{t('stopList')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => {
                  const cat = p.categoryId ? catById.get(p.categoryId) : undefined
                  return (
                    <tr key={p.id} className={p.active ? '' : 'text-slate-400'}>
                      <td className="px-4 py-3 font-medium">
                        {p.favorite && <span className="mr-1 text-amber-500" title={t('favorite')}>★</span>}
                        {p.name[lang]}
                      </td>
                      <td className="px-4 py-3">
                        {cat ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="size-3 rounded-full" style={{ background: cat.color ?? '#94a3b8' }} />
                            {cat.name[lang]}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{money(p.price)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{p.cost ? money(p.cost) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{p.cost ? `${markup(p.price, p.cost)}%` : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <Switch label={t('onSale')} checked={p.active} disabled={!canEdit} onChange={(v) => void flag(p, { active: v })} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Switch label={t('stopList')} tone="red" checked={p.stopped} disabled={!canEdit} onChange={(v) => void flag(p, { stopped: v })} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && (
                          <button
                            className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
                            onClick={() => {
                              setError(null)
                              setPDraft({ ...p, price: String(p.price), cost: p.cost ? String(p.cost) : '', barcode: p.barcode ?? '' })
                            }}
                          >
                            {t('edit')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      {t('emptyList')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ───── Категории: показываем так, как они будут выглядеть на кассе ───── */}
      {products && tab === 'categories' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <button
              key={c.id}
              disabled={!canEdit}
              onClick={() => {
                setError(null)
                setCDraft({ id: c.id, name: c.name, color: c.color ?? TILE_COLORS[0], active: c.active })
              }}
              className={`relative flex h-24 cursor-pointer items-center justify-center rounded-xl p-3 text-center font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-default ${c.active ? '' : 'opacity-50'}`}
              style={{ background: c.color ?? '#64748b' }}
            >
              {c.name[lang]}
              <span className="absolute right-0 top-0 rounded-bl-lg rounded-tr-xl bg-black/30 px-2 py-0.5 text-xs font-medium">
                {c.productCount}
              </span>
            </button>
          ))}
          {categories.length === 0 && <div className="col-span-full card p-8 text-center text-sm text-slate-500">{t('emptyList')}</div>}
        </div>
      )}

      {/* ───── Отделы ───── */}
      {products && tab === 'departments' && (
        <div className="card divide-y divide-slate-100">
          {departments.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-slate-500">
                  {t('printer')}: {d.printer ?? '—'}
                </div>
              </div>
              {canEdit && (
                <button
                  className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
                  onClick={() => {
                    setError(null)
                    setDDraft({ id: d.id, name: d.name, printer: d.printer ?? '' })
                  }}
                >
                  {t('edit')}
                </button>
              )}
            </div>
          ))}
          {departments.length === 0 && <div className="p-8 text-center text-sm text-slate-500">{t('emptyList')}</div>}
        </div>
      )}

      {/* ───── Окно товара ───── */}
      {pDraft && (
        <Modal wide title={pDraft.id ? t('edit') : t('addProduct')} onClose={() => setPDraft(null)}>
          <form onSubmit={saveProduct} className="space-y-4">
            {nameFields(pDraft.name, (name) => setPDraft({ ...pDraft, name }))}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={`${t('price')}, ${t('sum')}`}>
                <input
                  className="input tabular-nums"
                  inputMode="numeric"
                  required
                  value={pDraft.price}
                  onChange={(e) => setPDraft({ ...pDraft, price: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                />
              </Field>
              <Field label={`${t('cost')}, ${t('sum')}`} hint={t('costHint')}>
                <input
                  className="input tabular-nums"
                  inputMode="numeric"
                  placeholder="0"
                  value={pDraft.cost}
                  onChange={(e) => setPDraft({ ...pDraft, cost: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                />
              </Field>
              <ProfitBox price={Number(pDraft.price) || 0} cost={Number(pDraft.cost) || 0} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('category')}>
                <select
                  className="input"
                  value={pDraft.categoryId ?? ''}
                  onChange={(e) => setPDraft({ ...pDraft, categoryId: e.target.value || null })}
                >
                  <option value="">{t('noCategory')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name[lang]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('department')} hint={t('departmentHint')}>
                <select
                  className="input"
                  value={pDraft.departmentId ?? ''}
                  onChange={(e) => setPDraft({ ...pDraft, departmentId: e.target.value || null })}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('barcode')}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={pDraft.barcode ?? ''}
                  onChange={(e) => setPDraft({ ...pDraft, barcode: e.target.value })}
                />
              </Field>
              <Field label={t('unit')}>
                <select
                  className="input"
                  value={pDraft.unit}
                  onChange={(e) => setPDraft({ ...pDraft, unit: e.target.value as Product['unit'] })}
                >
                  <option value="pcs">{t('unitPcs')}</option>
                  <option value="kg">{t('unitKg')}</option>
                  <option value="l">{t('unitL')}</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle label={t('onSale')} checked={pDraft.active} onChange={(v) => setPDraft({ ...pDraft, active: v })} />
              <Toggle label={t('stopList')} checked={pDraft.stopped} onChange={(v) => setPDraft({ ...pDraft, stopped: v })} />
              <Toggle label={t('favorite')} checked={pDraft.favorite} onChange={(v) => setPDraft({ ...pDraft, favorite: v })} />
              <Toggle label={t('byWeight')} checked={pDraft.byWeight} onChange={(v) => setPDraft({ ...pDraft, byWeight: v })} />
            </div>
            <ErrorNote text={error} />
            {formFooter(
              pDraft.id ? () => remove(`/products/${pDraft.id}`, () => setPDraft(null)) : null,
              () => setPDraft(null),
            )}
          </form>
        </Modal>
      )}

      {/* ───── Окно категории ───── */}
      {cDraft && (
        <Modal title={cDraft.id ? t('edit') : t('addCategory')} onClose={() => setCDraft(null)}>
          <form onSubmit={saveCategory} className="space-y-4">
            {nameFields(cDraft.name, (name) => setCDraft({ ...cDraft, name }))}
            <div>
              <span className="label">{t('color')}</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('color')}>
                {TILE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={cDraft.color === c}
                    aria-label={c}
                    onClick={() => setCDraft({ ...cDraft, color: c })}
                    className={`size-9 cursor-pointer rounded-full transition ${cDraft.color === c ? 'ring-2 ring-slate-900 ring-offset-2' : 'hover:scale-110'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <Toggle label={t('active')} checked={cDraft.active} onChange={(v) => setCDraft({ ...cDraft, active: v })} />
            <ErrorNote text={error} />
            {formFooter(
              cDraft.id ? () => remove(`/categories/${cDraft.id}`, () => setCDraft(null)) : null,
              () => setCDraft(null),
            )}
          </form>
        </Modal>
      )}

      {/* ───── Окно отдела ───── */}
      {dDraft && (
        <Modal title={dDraft.id ? t('edit') : t('addDepartment')} onClose={() => setDDraft(null)}>
          <form onSubmit={saveDepartment} className="space-y-4">
            <Field label={t('department')}>
              <input
                className="input"
                autoFocus
                required
                value={dDraft.name}
                onChange={(e) => setDDraft({ ...dDraft, name: e.target.value })}
              />
            </Field>
            <Field label={t('printer')} hint={t('departmentHint')}>
              <input className="input" value={dDraft.printer} onChange={(e) => setDDraft({ ...dDraft, printer: e.target.value })} />
            </Field>
            <ErrorNote text={error} />
            {formFooter(
              dDraft.id ? () => remove(`/departments/${dDraft.id}`, () => setDDraft(null)) : null,
              () => setDDraft(null),
            )}
          </form>
        </Modal>
      )}
    </div>
  )
}
