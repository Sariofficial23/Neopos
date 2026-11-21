import { useState, type FormEvent } from 'react'
import { api, type L10n } from './api'
import { useApp } from './app'
import { Dialog } from './Dialogs'

/** Полные записи меню с сервера: правка отправляет всю запись, чтобы не потерять поля, которых нет на кассе. */
export type FullCategory = { id: string; name: L10n; color: string | null; sort: number; active: boolean }
export type FullProduct = {
  id: string
  name: L10n
  categoryId: string | null
  departmentId: string | null
  price: number
  cost: number
  barcode: string | null
  unit: 'pcs' | 'kg' | 'l'
  byWeight: boolean
  favorite: boolean
  stopped: boolean
  active: boolean
  sort: number
}

export const loadMenu = async () => {
  const [categories, products] = await Promise.all([api<FullCategory[]>('/categories'), api<FullProduct[]>('/products')])
  return { categories, products }
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b']

/** Название на двух языках: достаточно заполнить один — второй подставит сервер. */
function NameFields({ value, onChange }: { value: L10n; onChange: (v: L10n) => void }) {
  const { t } = useApp()
  return (
    <div className="name-pair">
      <label className="field">
        <span>{t('nameUz')}</span>
        <input className="input" autoFocus maxLength={120} value={value.uz} onChange={(e) => onChange({ ...value, uz: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('nameRu')}</span>
        <input className="input" maxLength={120} value={value.ru} onChange={(e) => onChange({ ...value, ru: e.target.value })} />
      </label>
    </div>
  )
}

/** Добавить или изменить категорию меню. */
export function CategoryForm({ category, sort, onClose, onSaved }: { category: FullCategory | null; sort: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, fail, toast } = useApp()
  const [name, setName] = useState<L10n>(category?.name ?? { uz: '', ru: '' })
  const [color, setColor] = useState(category?.color ?? COLORS[5])
  const [busy, setBusy] = useState(false)
  const valid = !!(name.uz.trim() || name.ru.trim())

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await action()
      await onSaved()
      toast(done)
      onClose()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const body = { name, color, sort: category?.sort ?? sort, active: category?.active ?? true }
    void run(
      () => (category ? api(`/categories/${category.id}`, { method: 'PATCH', body }) : api('/categories', { method: 'POST', body })),
      t('savedOk'),
    )
  }

  const remove = () => {
    if (!category || !window.confirm(t('confirmDeleteCat'))) return
    void run(() => api(`/categories/${category.id}`, { method: 'DELETE' }), t('deletedOk'))
  }

  return (
    <Dialog title={category ? t('editCategory') : t('newCategory')} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        <NameFields value={name} onChange={setName} />
        <div className="field">
          <span>{t('color')}</span>
          <div className="swatches" role="radiogroup" aria-label={t('color')}>
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <button className="btn send wide" disabled={busy || !valid}>
          {t('save')}
        </button>
        {category && (
          <button type="button" className="btn plain wide danger-text" disabled={busy} onClick={remove}>
            {t('deleteCategory')}
          </button>
        )}
      </form>
    </Dialog>
  )
}

/** Добавить или изменить блюдо: название, цена, категория, отдел (куда печатать), стоп-лист. */
export function ProductForm({
  product,
  categoryId,
  categories,
  sort,
  onClose,
  onSaved,
}: {
  product: FullProduct | null
  categoryId: string | null
  categories: FullCategory[]
  sort: number
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, lang, boot, fail, toast } = useApp()
  const [name, setName] = useState<L10n>(product?.name ?? { uz: '', ru: '' })
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [cat, setCat] = useState(product?.categoryId ?? categoryId ?? '')
  const [dep, setDep] = useState(product?.departmentId ?? boot.departments[0]?.id ?? '')
  const [stopped, setStopped] = useState(product?.stopped ?? false)
  const [busy, setBusy] = useState(false)
  const valid = !!(name.uz.trim() || name.ru.trim()) && price !== ''

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await action()
      await onSaved()
      toast(done)
      onClose()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const body = {
      // Поля, которых нет в форме кассы (себестоимость, штрихкод…), остаются как были.
      cost: 0,
      unit: 'pcs',
      byWeight: false,
      favorite: false,
      active: true,
      sort,
      barcode: null,
      ...(product ?? {}),
      name,
      price: Number(price),
      categoryId: cat || null,
      departmentId: dep || null,
      stopped,
    }
    void run(() => (product ? api(`/products/${product.id}`, { method: 'PATCH', body }) : api('/products', { method: 'POST', body })), t('savedOk'))
  }

  const remove = () => {
    if (!product || !window.confirm(t('confirmDeleteProduct'))) return
    void run(() => api(`/products/${product.id}`, { method: 'DELETE' }), t('deletedOk'))
  }

  return (
    <Dialog title={product ? t('editProduct') : t('newProduct')} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <NameFields value={name} onChange={setName} />
        <label className="field">
          <span>
            {t('price')}, {t('sum')}
          </span>
          <input className="input num" inputMode="numeric" required placeholder="0" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 10))} />
        </label>
        <div className="name-pair">
          <label className="field">
            <span>{t('category')}</span>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name[lang]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('department')}</span>
            <select className="input" value={dep} onChange={(e) => setDep(e.target.value)}>
              <option value="">—</option>
              {boot.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="switch-row">
          <span>{t('stopList')}</span>
          <input type="checkbox" role="switch" className="switch" checked={stopped} onChange={(e) => setStopped(e.target.checked)} />
        </label>
        <button className="btn send wide" disabled={busy || !valid}>
          {t('save')}
        </button>
        {product && (
          <button type="button" className="btn plain wide danger-text" disabled={busy} onClick={remove}>
            {t('deleteProduct')}
          </button>
        )}
      </form>
    </Dialog>
  )
}
