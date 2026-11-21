import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Segmented } from '../ui'

type Cat = { id: string; kind: 'expense' | 'income'; parentId: string | null; name: string; sort: number }

/** Категории расходов и доходов кассы: их выбирает кассир в «Добавить операцию». */
export function FinanceCategoriesCard() {
  const { t, tErr } = useI18n()
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [cats, setCats] = useState<Cat[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      setCats(await api<Cat[]>('/finance-categories'))
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  const own = (cats ?? []).filter((c) => c.kind === kind)
  const tops = own.filter((c) => !c.parentId)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await api('/finance-categories', { method: 'POST', body: { kind, name: newName.trim(), parentId: newParent || null, sort: own.length } })
      setNewName('')
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  async function rename(c: Cat, name: string) {
    try {
      await api(`/finance-categories/${c.id}`, { method: 'PATCH', body: { kind: c.kind, name, parentId: c.parentId, sort: c.sort } })
      setEditing(null)
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  async function remove(c: Cat) {
    const subs = own.filter((x) => x.parentId === c.id).length
    if (!window.confirm(`${c.name}\n\n${subs ? t('catDeleteWithSubs') : t('confirmDelete')}`)) return
    try {
      await api(`/finance-categories/${c.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  const row = (c: Cat, child: boolean) => (
    <div key={c.id} className={`flex items-center justify-between gap-2 py-2 ${child ? 'pl-6' : ''}`}>
      {editing?.id === c.id ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (editing.name.trim()) void rename(c, editing.name.trim())
          }}
        >
          <input className="input h-9" autoFocus maxLength={60} value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} />
          <button className="btn btn-primary h-9">{t('save')}</button>
          <button type="button" className="btn btn-ghost h-9" onClick={() => setEditing(null)}>
            {t('cancel')}
          </button>
        </form>
      ) : (
        <>
          <span className={child ? 'text-slate-700' : 'font-medium'}>
            {child ? '— ' : ''}
            {c.name}
          </span>
          <span className="flex gap-3 text-sm">
            <button type="button" className="cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => setEditing({ id: c.id, name: c.name })}>
              {t('edit')}
            </button>
            <button type="button" className="cursor-pointer font-medium text-red-600 hover:underline" onClick={() => void remove(c)}>
              {t('delete')}
            </button>
          </span>
        </>
      )}
    </div>
  )

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('financeCats')}</h2>
        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k)
            setNewParent('')
          }}
          options={[
            { value: 'expense', label: t('catExpense') },
            { value: 'income', label: t('catIncome') },
          ]}
        />
      </div>
      <p className="text-sm text-slate-500">{t('financeCatsHint')}</p>
      <ErrorNote text={error} />
      {!cats ? (
        <div className="text-sm text-slate-500">{t('loading')}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {tops.map((top) => (
            <div key={top.id}>
              {row(top, false)}
              {own.filter((c) => c.parentId === top.id).map((c) => row(c, true))}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <input className="input min-w-40 flex-1" maxLength={60} placeholder={t('catNewName')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select className="input w-auto" value={newParent} onChange={(e) => setNewParent(e.target.value)} aria-label={t('catParent')}>
          <option value="">{t('catTopLevel')}</option>
          {tops.map((c) => (
            <option key={c.id} value={c.id}>
              {t('catInside')} «{c.name}»
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!newName.trim()}>
          + {t('create')}
        </button>
      </form>
    </section>
  )
}
