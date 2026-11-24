import { useEffect, useState } from 'react'
import { api, ApiError, money } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote } from '../ui'

export type SubscriptionData = {
  tariff: string
  monthlyFee: number
  nextPaymentAt: string | null
  overdue: boolean
  payments: { id: string; amount: number; method: string; note: string | null; createdAt: string }[]
}

export const SUB = {
  title: { uz: 'Abonent to‘lovi', ru: 'Абонентская плата' },
  next: { uz: 'Keyingi to‘lov', ru: 'Следующий платёж' },
  fee: { uz: 'Abonent to‘lovi', ru: 'Абонентская плата' },
  perMonth: { uz: 'so‘m / oy', ru: 'сум / месяц' },
  tariff: { uz: 'Tarif', ru: 'Тариф' },
  notSet: { uz: 'belgilanmagan', ru: 'не назначен' },
  overdue: { uz: 'To‘lov muddati o‘tgan', ru: 'Срок оплаты прошёл' },
  pay: { uz: 'To‘lash', ru: 'Оплатить' },
  payHint: {
    uz: 'To‘lov uchun NeoPos menejeri bilan bog‘laning. To‘lov qabul qilingach, u shu ro‘yxatda paydo bo‘ladi.',
    ru: 'Для оплаты свяжитесь с менеджером NeoPos. После получения платёж появится в этом списке.',
  },
  created: { uz: 'Sana', ru: 'Создан' },
  amount: { uz: 'Summa', ru: 'Сумма' },
  method: { uz: 'To‘lov usuli', ru: 'Способ оплаты' },
  empty: { uz: 'To‘lovlar hali yo‘q', ru: 'Платежей пока нет' },
} as const

const TZ = 'Asia/Tashkent'
export const subDate = (iso: string | null, lang: 'uz' | 'ru') =>
  iso ? new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }) : null
export const subDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** «Абонентская плата», как в Clopos: следующий платёж, сумма, тариф и история платежей. */
export function SubscriptionPage() {
  const { t, tErr, lang } = useI18n()
  const [data, setData] = useState<SubscriptionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState(false)

  useEffect(() => {
    api<SubscriptionData>('/subscription')
      .then(setData)
      .catch((err) => setError(tErr(err instanceof ApiError ? err.code : 'internal')))
  }, [tErr])

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-2xl font-semibold">{SUB.title[lang]}</h1>
      <ErrorNote text={error} />
      {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {data && (
        <>
          <section className="card mb-4 flex flex-wrap items-center gap-x-10 gap-y-4 p-5">
            <div>
              <div className="text-sm text-slate-500">{SUB.next[lang]}</div>
              <div className={`text-xl font-semibold ${data.overdue ? 'text-red-600' : ''}`}>{subDate(data.nextPaymentAt, lang) ?? SUB.notSet[lang]}</div>
              {data.overdue && <div className="text-sm font-medium text-red-600">{SUB.overdue[lang]}</div>}
            </div>
            <div>
              <div className="text-sm text-slate-500">{SUB.fee[lang]}</div>
              <div className="text-xl font-semibold tabular-nums">
                {money(data.monthlyFee)} <span className="text-sm font-normal text-slate-500">{SUB.perMonth[lang]}</span>
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-500">{SUB.tariff[lang]}</div>
              <div className="text-xl font-semibold">{data.tariff}</div>
            </div>
            <button className="btn ml-auto bg-emerald-500 text-white hover:bg-emerald-600" onClick={() => setHint(true)}>
              {SUB.pay[lang]}
            </button>
          </section>
          {hint && (
            <div role="status" className="mb-4 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
              {SUB.payHint[lang]}
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{SUB.created[lang]}</th>
                  <th className="px-4 py-3 text-right">{SUB.amount[lang]}</th>
                  <th className="px-4 py-3">{SUB.method[lang]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                      {SUB.empty[lang]}
                    </td>
                  </tr>
                )}
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">{subDateTime(p.createdAt)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{money(p.amount)}</td>
                    <td className="px-4 py-3">
                      {p.method || '—'}
                      {p.note && <span className="ml-2 text-slate-500">{p.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
