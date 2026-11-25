import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type L10n } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Switch } from '../ui'

type Reason = { id: string; name: L10n; active: boolean }

/** «Причины удаления позиции»: список, который кассир видит при удалении отправленной позиции из чека. */
export function ReasonsCard() {
  const { t, tErr, lang } = useI18n()
  const [rows, setRows] = useState<Reason[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      setRows(await api<Reason[]>('/reasons'))
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      setEditing(null)
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  /** Название правится на текущем языке панели; второй язык остаётся прежним. */
  const rename = (r: Reason, name: string) => run(() => api(`/reasons/${r.id}`, { method: 'PATCH', body: { name: { ...r.name, [lang]: name }, active: r.active } }))

  function add(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    void run(async () => {
      await api('/reasons', { method: 'POST', body: { name: { uz: name, ru: name } } })
      setNewName('')
    })
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{t('reasonsTitle')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('reasonsHint')}</p>
      </div>
      <ErrorNote text={error} />
      {!rows && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {rows && (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              {editing?.id === r.id ? (
                <form
                  className="flex min-w-0 flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (editing.name.trim()) void rename(r, editing.name.trim())
                  }}
                >
                  <input className="input" autoFocus maxLength={80} value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} />
                  <button className="btn btn-primary">{t('save')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                    {t('cancel')}
                  </button>
                </form>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 truncate font-medium ${r.active ? '' : 'text-slate-400'}`}>{r.name[lang]}</span>
                  <button className="cursor-pointer text-sm font-medium text-brand-600 hover:underline" onClick={() => setEditing({ id: r.id, name: r.name[lang] })}>
                    {t('edit')}
                  </button>
                  <Switch label={r.name[lang]} checked={r.active} onChange={(v) => void run(() => api(`/reasons/${r.id}`, { method: 'PATCH', body: { name: r.name, active: v } }))} />
                </>
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="py-6 text-center text-sm text-slate-500">{t('emptyList')}</li>}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input className="input" placeholder={t('reasonNew')} aria-label={t('reasonNew')} maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-ghost whitespace-nowrap" disabled={!newName.trim()}>
          + {t('reasonAdd')}
        </button>
      </form>
    </section>
  )
}
