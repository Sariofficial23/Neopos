import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Field, Toggle } from '../ui'
import { BrandCard } from './Brand'
import { FinanceCategoriesCard } from './FinanceCategories'
import { PaymentMethodsCard } from './PaymentMethods'

type Settings = {
  name: string
  address: string
  phone: string
  receiptHeader: string
  receiptFooter: string
  receiptShowWaiter: boolean
  receiptShowGuests: boolean
  receiptShowTime: boolean
  printKitchen: boolean
  printReceipt: boolean
  tableRedMinutes: number
}

export function SettingsPage() {
  const { t, tErr, lang } = useI18n()
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

  const row = (a: string, b: string, cls = '') => (
    <div className={`flex justify-between gap-3 ${cls}`}>
      <span>{a}</span>
      <span className="whitespace-nowrap text-right">{b}</span>
    </div>
  )
  const rule = <div className="my-2 border-t border-dashed border-slate-400" />
  const ru = lang === 'ru'

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-2xl font-semibold">{t('navSettings')}</h1>
      {!form && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {!form && <ErrorNote text={error} />}
      {form && (
        // Слева — что печатать, справа — как чек будет выглядеть. Рядом уже на ширине планшета.
        <form onSubmit={save} className="grid items-start gap-5 min-[700px]:grid-cols-[minmax(0,1fr)_272px]">
          <div className="space-y-5">
            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">{t('setVenue')}</h2>
              <Field label={t('venueName')}>
                <input className="input" required minLength={2} maxLength={80} value={form.name} onChange={(e) => up('name', e.target.value)} />
              </Field>
              <Field label={t('address')}>
                <input className="input" maxLength={160} value={form.address} onChange={(e) => up('address', e.target.value)} />
              </Field>
              <Field label={t('phone')}>
                <input className="input" inputMode="tel" maxLength={40} placeholder="+998" value={form.phone} onChange={(e) => up('phone', e.target.value)} />
              </Field>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">{t('setReceiptText')}</h2>
              <Field label={t('receiptHeader')} hint={t('receiptHeaderHint')}>
                <input className="input" maxLength={120} value={form.receiptHeader} onChange={(e) => up('receiptHeader', e.target.value)} />
              </Field>
              <Field label={t('receiptFooter')} hint={t('receiptFooterHint')}>
                <input className="input" maxLength={200} value={form.receiptFooter} onChange={(e) => up('receiptFooter', e.target.value)} />
              </Field>
              <div className="grid gap-2">
                <Toggle label={t('showTime')} checked={form.receiptShowTime} onChange={(v) => up('receiptShowTime', v)} />
                <Toggle label={t('showWaiter')} checked={form.receiptShowWaiter} onChange={(v) => up('receiptShowWaiter', v)} />
                <Toggle label={t('showGuests')} checked={form.receiptShowGuests} onChange={(v) => up('receiptShowGuests', v)} />
              </div>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">{t('setPrint')}</h2>
              <div className="grid gap-2">
                <Toggle label={t('printKitchen')} checked={form.printKitchen} onChange={(v) => up('printKitchen', v)} />
                <Toggle label={t('printReceipt')} checked={form.printReceipt} onChange={(v) => up('printReceipt', v)} />
              </div>
              <p className="text-xs text-slate-500">{t('printNote')}</p>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">{t('setTerminal')}</h2>
              <Field label={t('tableRedMinutes')} hint={t('tableRedHint')}>
                <input
                  className="input max-w-40"
                  inputMode="numeric"
                  value={form.tableRedMinutes ? String(form.tableRedMinutes) : ''}
                  placeholder="0"
                  onChange={(e) => up('tableRedMinutes', Math.min(1000, Number(e.target.value.replace(/[^0-9]/g, '')) || 0))}
                />
              </Field>
            </section>

            <ErrorNote text={error} />
            <div className="flex items-center gap-3">
              <button className="btn btn-primary" disabled={busy}>
                {t('save')}
              </button>
              {saved && <span className="text-sm font-medium text-emerald-600">✓ {t('savedOk')}</span>}
            </div>
          </div>

          {/* Живой вид чека: меняется сразу при правке слева и остаётся на экране при прокрутке */}
          <aside aria-label={t('receiptPreview')} className="min-[700px]:sticky min-[700px]:top-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('receiptPreview')}</div>
            <div className="rounded-lg bg-white p-4 font-mono text-[11px] leading-relaxed text-slate-900 shadow-md ring-1 ring-slate-200">
              <div className="text-center text-sm font-bold">{form.name || '—'}</div>
              {form.address && <div className="text-center">{form.address}</div>}
              {form.phone && <div className="text-center">{form.phone}</div>}
              {form.receiptHeader && <div className="text-center">{form.receiptHeader}</div>}
              {rule}
              {row(`${ru ? 'Чек' : 'Chek'} №128`, form.receiptShowTime ? '21.11.2026, 19:40' : '')}
              {row(`${ru ? 'Стол' : 'Stol'} 5`, form.receiptShowGuests ? `${ru ? 'Гостей' : 'Mehmonlar'}: 2` : '')}
              {form.receiptShowWaiter && row(ru ? 'Официант' : 'Ofitsiant', 'Aziz')}
              {rule}
              <div className="font-bold">Osh (to‘y oshi)</div>
              {row('2 × 38 000', '76 000')}
              <div className="mt-1 font-bold">Ko‘k choy</div>
              {row('1 × 6 000', '6 000')}
              {rule}
              {row(ru ? 'Сумма' : 'Summa', '82 000')}
              {row(`${ru ? 'Обслуживание' : 'Xizmat haqi'} 10%`, '8 200')}
              {row(t('total'), '90 200', 'mt-1 text-sm font-bold')}
              {rule}
              {row(ru ? 'Наличные' : 'Naqd', '100 000')}
              {row(ru ? 'Сдача' : 'Qaytim', '9 800')}
              {rule}
              {form.receiptFooter && <div className="text-center">{form.receiptFooter}</div>}
              <div className="mt-1 text-center text-[9px]">{ru ? 'Не является фискальным чеком' : 'Bu fiskal chek emas'}</div>
            </div>
          </aside>
        </form>
      )}
      <div className="mt-5 space-y-5 min-[700px]:mr-[292px]">
        <PaymentMethodsCard />
        <BrandCard />
        <FinanceCategoriesCard />
      </div>
    </div>
  )
}
