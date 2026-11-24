import { useEffect, useState, type FormEvent } from 'react'
import { money } from '../api'
import { useI18n } from '../i18n'
import { SUB, subDate, subDateTime, type SubscriptionData } from '../pages/Subscription'
import { ErrorNote, Field, Modal } from '../ui'
import { adminApi } from './Admin'

const W = {
  title: { uz: 'Abonent to‘lovi', ru: 'Абонентская плата' },
  fee: { uz: 'Oylik to‘lov, so‘m', ru: 'Плата в месяц, сум' },
  nextDate: { uz: 'Keyingi to‘lov sanasi', ru: 'Дата следующего платежа' },
  saveTariff: { uz: 'Tarifni saqlash', ru: 'Сохранить тариф' },
  saved: { uz: 'Saqlandi', ru: 'Сохранено' },
  addPayment: { uz: 'To‘lovni qayd etish', ru: 'Отметить платёж' },
  amount: { uz: 'Summa, so‘m', ru: 'Сумма, сум' },
  methodPh: { uz: 'Naqd, karta, o‘tkazma…', ru: 'Наличные, карта, перечисление…' },
  months: { uz: 'Necha oyga uzaytirish', ru: 'Продлить на месяцев' },
  add: { uz: 'Qo‘shish', ru: 'Добавить' },
  history: { uz: 'To‘lovlar tarixi', ru: 'История платежей' },
  remove: { uz: 'O‘chirish', ru: 'Удалить' },
  confirmRemove: { uz: 'To‘lov yozuvi o‘chirilsinmi? Keyingi to‘lov sanasi o‘zgarmaydi.', ru: 'Удалить запись о платеже? Дата следующего платежа не изменится.' },
  error: { uz: 'Saqlab bo‘lmadi', ru: 'Не удалось сохранить' },
} as const

/** Дата для поля <input type="date"> по времени Ташкента и обратно. */
const toDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5 * 3_600_000).toISOString().slice(0, 10) : '')
const fromDay = (day: string) => (day ? new Date(`${day}T12:00:00+05:00`).toISOString() : null)

/** Админ-панель: тариф бренда, дата следующего платежа и отметка полученных платежей. */
export function BillingModal({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const { lang } = useI18n()
  const base = `/admin/tenants/${brandId}/subscription`
  const [data, setData] = useState<SubscriptionData | null>(null)
  const [tariff, setTariff] = useState('')
  const [fee, setFee] = useState('')
  const [day, setDay] = useState('')
  const [pay, setPay] = useState({ amount: '', method: '', months: '1' })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = (d: SubscriptionData) => {
    setData(d)
    setTariff(d.tariff)
    setFee(String(d.monthlyFee))
    setDay(toDay(d.nextPaymentAt))
    setPay((p) => ({ ...p, amount: p.amount || (d.monthlyFee ? String(d.monthlyFee) : '') }))
  }

  useEffect(() => {
    adminApi<SubscriptionData>(base)
      .then(apply)
      .catch(() => setError(W.error[lang]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  async function run(action: () => Promise<SubscriptionData>, done?: () => void) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      apply(await action())
      done?.()
    } catch {
      setError(W.error[lang])
    } finally {
      setBusy(false)
    }
  }

  const saveTariff = (e: FormEvent) => {
    e.preventDefault()
    void run(
      () => adminApi<SubscriptionData>(base, { method: 'PATCH', body: { tariff: tariff.trim() || 'Standard', monthlyFee: Number(fee) || 0, nextPaymentAt: fromDay(day) } }),
      () => setSaved(true),
    )
  }

  const addPayment = (e: FormEvent) => {
    e.preventDefault()
    if (!Number(pay.amount)) return
    void run(
      () => adminApi<SubscriptionData>(`${base}/payments`, { method: 'POST', body: { amount: Number(pay.amount), method: pay.method.trim(), months: Number(pay.months) || 0 } }),
      () => setPay({ amount: '', method: pay.method, months: '1' }),
    )
  }

  const removePayment = (id: string) => {
    if (!window.confirm(W.confirmRemove[lang])) return
    void run(() => adminApi<SubscriptionData>(`${base}/payments/${id}`, { method: 'DELETE' }))
  }

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 10)

  return (
    <Modal title={`${W.title[lang]} · ${brandName}`} onClose={onClose} wide>
      <div className="space-y-5">
        <ErrorNote text={error} />
        {!data && !error && <div className="text-sm text-slate-500">…</div>}
        {data && (
          <>
            <form onSubmit={saveTariff} className="grid gap-3 sm:grid-cols-3">
              <Field label={SUB.tariff[lang]}>
                <input className="input" maxLength={40} value={tariff} onChange={(e) => setTariff(e.target.value)} />
              </Field>
              <Field label={W.fee[lang]}>
                <input className="input" inputMode="numeric" value={fee} onChange={(e) => setFee(digits(e.target.value))} />
              </Field>
              <Field label={W.nextDate[lang]}>
                <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <div className="flex items-center gap-3 sm:col-span-3">
                <button className="btn btn-primary" disabled={busy}>
                  {W.saveTariff[lang]}
                </button>
                {saved && <span className="text-sm font-medium text-emerald-600">✓ {W.saved[lang]}</span>}
                {data.overdue && <span className="text-sm font-medium text-red-600">{SUB.overdue[lang]}</span>}
              </div>
            </form>

            <form onSubmit={addPayment} className="space-y-3 rounded-lg bg-slate-50 p-4">
              <div className="font-medium">{W.addPayment[lang]}</div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
                <Field label={W.amount[lang]}>
                  <input className="input" inputMode="numeric" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: digits(e.target.value) })} />
                </Field>
                <Field label={SUB.method[lang]}>
                  <input className="input" maxLength={40} placeholder={W.methodPh[lang]} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} />
                </Field>
                <Field label={W.months[lang]}>
                  <input className="input" inputMode="numeric" value={pay.months} onChange={(e) => setPay({ ...pay, months: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                </Field>
                <button className="btn btn-primary" disabled={busy || !Number(pay.amount)}>
                  + {W.add[lang]}
                </button>
              </div>
            </form>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="font-medium">{W.history[lang]}</span>
                <span className="text-sm text-slate-500">
                  {SUB.next[lang]}: {subDate(data.nextPaymentAt, lang) ?? SUB.notSet[lang]}
                </span>
              </div>
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
                {data.payments.length === 0 && <div className="px-3 py-6 text-center text-slate-500">{SUB.empty[lang]}</div>}
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-slate-600">{subDateTime(p.createdAt)}</span>
                    <span className="flex-1 truncate">{p.method}</span>
                    <b className="tabular-nums">{money(p.amount)}</b>
                    <button type="button" className="cursor-pointer text-red-600 hover:underline" onClick={() => removePayment(p.id)}>
                      {W.remove[lang]}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
