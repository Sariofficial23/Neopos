import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Toggle } from '../ui'

type Kind = 'cash' | 'card' | 'transfer' | 'other'
type Method = { id: string; kind: Kind; name: { uz: string; ru: string }; active: boolean; sort: number }

const KINDS: Kind[] = ['cash', 'card', 'transfer', 'other']

/** «Способы оплаты»: что кассир видит в окне оплаты. Выключенный способ на кассе не показывается. */
export function PaymentMethodsCard() {
  const { t, tErr, lang } = useI18n()
  const [rows, setRows] = useState<Method[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<Kind>('transfer')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      setRows(await api<Method[]>('/payment-methods'))
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  async function save(m: Method, patch: Partial<Method>) {
    try {
      const next = { ...m, ...patch }
      await api(`/payment-methods/${m.id}`, { method: 'PATCH', body: { name: next.name, kind: next.kind, active: next.active, sort: next.sort } })
      setEditing(null)
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  async function remove(m: Method) {
    if (!window.confirm(`${m.name[lang]}\n\n${t('confirmDelete')}`)) return
    try {
      await api(`/payment-methods/${m.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      await api('/payment-methods', { method: 'POST', body: { name: { uz: name, ru: name }, kind: newKind, sort: (rows?.length ?? 0) + 1 } })
      setNewName('')
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <h2 className="font-semibold">{t('payMethods')}</h2>
      <p className="text-sm text-slate-500">{t('payMethodsHint')}</p>
      <ErrorNote text={error} />
      {!rows ? (
        <div className="text-sm text-slate-500">{t('loading')}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-48 flex-1">
                {editing?.id === m.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const v = editing.name.trim()
                      if (v) void save(m, { name: { ...m.name, [lang]: v } })
                    }}
                  >
                    <input className="input h-9" autoFocus maxLength={40} value={editing.name} onChange={(e) => setEditing({ id: m.id, name: e.target.value })} />
                    <button className="btn btn-primary h-9">{t('save')}</button>
                  </form>
                ) : (
                  <Toggle label={`${m.name[lang]} · ${t(`payKind.${m.kind}`)}`} checked={m.active} onChange={(v) => void save(m, { active: v })} />
                )}
              </div>
              <span className="flex gap-3 text-sm">
                <button type="button" className="cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => setEditing({ id: m.id, name: m.name[lang] })}>
                  {t('edit')}
                </button>
                <button type="button" className="cursor-pointer font-medium text-red-600 hover:underline" onClick={() => void remove(m)}>
                  {t('delete')}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <input className="input min-w-40 flex-1" maxLength={40} placeholder={t('payMethodNew')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select className="input w-auto" value={newKind} onChange={(e) => setNewKind(e.target.value as Kind)} aria-label={t('payMethodKind')}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`payKind.${k}`)}
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
