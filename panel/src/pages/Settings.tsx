import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Field, Toggle } from '../ui'

type Settings = {
  name: string
  address: string
  phone: string
  receiptFooter: string
  printKitchen: boolean
  printReceipt: boolean
}

export function SettingsPage() {
  const { t, tErr } = useI18n()
  const [form, setForm] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  useEffect(() => {
    api<Settings>('/settings')
      .then(setForm)
      .catch((err) => setError(errText(err)))
  }, [errText])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      setForm(await api<Settings>('/settings', { method: 'PATCH', body: form }))
      setSaved(true)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const up = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false)
    setForm((f) => (f ? { ...f, [k]: v } : f))
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-2xl font-semibold">{t('navSettings')}</h1>
      {!form && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {!form && <ErrorNote text={error} />}
      {form && (
        <form onSubmit={save} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5">
            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">{t('setVenue')}</h2>
              <Field label={t('venueName')}>
                <input className="input" required minLength={2} maxLength={80} value={form.name} onChange={(e) => up('name', e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('address')}>
                  <input className="input" maxLength={160} value={form.address} onChange={(e) => up('address', e.target.value)} />
                </Field>
                <Field label={t('phone')}>
                  <input className="input" inputMode="tel" maxLength={40} placeholder="+998" value={form.phone} onChange={(e) => up('phone', e.target.value)} />
                </Field>
              </div>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">{t('setPrint')}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label={t('printKitchen')} checked={form.printKitchen} onChange={(v) => up('printKitchen', v)} />
                <Toggle label={t('printReceipt')} checked={form.printReceipt} onChange={(v) => up('printReceipt', v)} />
              </div>
              <Field label={t('receiptFooter')} hint={t('receiptFooterHint')}>
                <input className="input" maxLength={200} value={form.receiptFooter} onChange={(e) => up('receiptFooter', e.target.value)} />
              </Field>
              <p className="text-xs text-slate-500">{t('printNote')}</p>
            </section>

            <ErrorNote text={error} />
            <div className="flex items-center gap-3">
              <button className="btn btn-primary" disabled={busy}>
                {t('save')}
              </button>
              {saved && <span className="text-sm font-medium text-emerald-600">✓ {t('savedOk')}</span>}
            </div>
          </div>

          {/* Как будет выглядеть шапка и подвал чека */}
          <aside aria-label={t('receiptPreview')}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('receiptPreview')}</div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs leading-relaxed text-slate-900 shadow-sm">
              <div className="text-center text-sm font-bold">{form.name || '—'}</div>
              {form.address && <div className="text-center">{form.address}</div>}
              {form.phone && <div className="text-center">{form.phone}</div>}
              <div className="my-2 border-t border-dashed border-slate-400" />
              <div className="flex justify-between">
                <span>2 × Osh</span>
                <span>76 000</span>
              </div>
              <div className="flex justify-between">
                <span>1 × Ko‘k choy</span>
                <span>6 000</span>
              </div>
              <div className="my-2 border-t border-dashed border-slate-400" />
              <div className="flex justify-between text-sm font-bold">
                <span>{t('total')}</span>
                <span>82 000</span>
              </div>
              {form.receiptFooter && (
                <>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="text-center">{form.receiptFooter}</div>
                </>
              )}
            </div>
          </aside>
        </form>
      )}
    </div>
  )
}
