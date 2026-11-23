import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError, money, type L10n } from '../api'
import { LangSwitch, useI18n } from '../i18n'
import { dateTime, dayAgo, type Period } from '../period'
import { useSession } from '../session'

/**
 * Мини-приложение NeoPos в Telegram (адрес /tg): владелец входит тем же логином и паролем,
 * что и в веб-панель, и видит отчёты своего заведения. Экран рассчитан на телефон.
 */

type Tg = { ready: () => void; expand: () => void; setHeaderColor?: (c: string) => void; HapticFeedback?: { impactOccurred: (s: string) => void } }
const tg = () => (window as unknown as { Telegram?: { WebApp?: Tg } }).Telegram?.WebApp

/** Подключает мост Telegram: разворачивает окно на весь экран. Вне Telegram страница работает как обычный сайт. */
function useTelegram() {
  useEffect(() => {
    const start = () => {
      tg()?.ready()
      tg()?.expand()
      tg()?.setHeaderColor?.('#0f172a')
    }
    if (tg()) return start()
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-web-app.js'
    s.onload = start
    document.head.append(s)
  }, [])
}

const W = {
  title: { uz: 'Hisobotlar', ru: 'Отчёты' },
  hint: { uz: 'Veb-paneldagi login va parolingiz bilan kiring', ru: 'Войдите логином и паролем от веб-панели' },
  today: { uz: 'Bugun', ru: 'Сегодня' },
  yesterday: { uz: 'Kecha', ru: 'Вчера' },
  week: { uz: '7 kun', ru: '7 дней' },
  month: { uz: '30 kun', ru: '30 дней' },
  profit: { uz: 'Yalpi foyda', ru: 'Валовая прибыль' },
  payments: { uz: 'To‘lov turlari', ru: 'Оплата' },
  cash: { uz: 'Kassa operatsiyalari', ru: 'Операции кассы' },
  expense: { uz: 'Xarajatlar', ru: 'Расходы' },
  income: { uz: 'Kirimlar', ru: 'Доходы' },
  collection: { uz: 'Inkassatsiya', ru: 'Инкассация' },
  top: { uz: 'Eng ko‘p sotilgan taomlar', ru: 'Топ блюд' },
  staff: { uz: 'Xodimlar', ru: 'Сотрудники' },
  shifts: { uz: 'Smenalar', ru: 'Смены' },
  shift: { uz: 'Smena', ru: 'Смена' },
  open: { uz: 'ochiq', ru: 'открыта' },
  diff: { uz: 'Farq', ru: 'Расхождение' },
  voids: { uz: 'O‘chirilgan pozitsiyalar', ru: 'Удалённые позиции' },
  discounts: { uz: 'Chegirmalar', ru: 'Скидки' },
  empty: { uz: 'Bu davrda savdo yo‘q', ru: 'За этот период продаж нет' },
  noAccess: { uz: 'Bu hisobda hisobotlarni ko‘rish huquqi yo‘q', ru: 'У этой учётной записи нет права смотреть отчёты' },
  noCategory: { uz: 'Kategoriyasiz', ru: 'Без категории' },
  refresh: { uz: 'Yangilash', ru: 'Обновить' },
  pcs: { uz: 'dona', ru: 'шт' },
} as const

type Summary = {
  totals: { receipts: number; revenue: number; guests: number; discounts: number; average: number; profit: number; cost: number }
  voids: { count: number; amount: number }
  cash: { expense: number; income: number; collection: number; byCategory: { type: string; name: string | null; parent: string | null; amount: number }[] }
  byMethod: { id: string; name: L10n; amount: number }[]
  byWaiter: { id: string; name: string; receipts: number; revenue: number }[]
  byProduct: { productId: string | null; name: L10n; qty: number; amount: number }[]
}
type ShiftRow = { id: string; number: number; openedAt: string; closedAt: string | null; expectedCash: number | null; countedCash: number | null; receipts: number; revenue: number }

const PERIODS = [
  { key: 'today', period: (): Period => ({ from: dayAgo(0), to: dayAgo(0) }) },
  { key: 'yesterday', period: (): Period => ({ from: dayAgo(1), to: dayAgo(1) }) },
  { key: 'week', period: (): Period => ({ from: dayAgo(6), to: dayAgo(0) }) },
  { key: 'month', period: (): Period => ({ from: dayAgo(29), to: dayAgo(0) }) },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

const qty = (q: number) => (q % 1000 === 0 ? String(q / 1000) : (q / 1000).toFixed(2).replace('.', ','))

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  )
}

const Row = ({ name, sub, value, strong }: { name: string; sub?: string; value: string; strong?: boolean }) => (
  <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
    <span className="min-w-0">
      <span className={`block truncate ${strong ? 'font-semibold' : ''}`}>{name}</span>
      {sub && <span className="block text-xs text-slate-500">{sub}</span>}
    </span>
    <span className={`whitespace-nowrap tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</span>
  </div>
)

function TgLogin() {
  const { t, tErr, lang } = useI18n()
  const { signIn } = useSession()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { token } = await api<{ token: string }>('/auth/login', { method: 'POST', body: form })
      await signIn(token)
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center gap-5 p-5">
      <div className="flex items-center justify-between">
        <img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" className="h-12 w-auto rounded-lg" />
        <LangSwitch />
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div>
          <h1 className="text-lg font-semibold">{t('signIn')}</h1>
          <p className="text-sm text-slate-500">{W.hint[lang]}</p>
        </div>
        <label className="block text-sm font-medium">
          {t('login')}
          <input className="input mt-1 h-12 text-base" required autoCapitalize="none" autoComplete="username" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </label>
        <label className="block text-sm font-medium">
          {t('password')}
          <input className="input mt-1 h-12 text-base" type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
        <button className="btn btn-primary h-12 w-full text-base" disabled={busy}>
          {busy ? t('loading') : t('signIn')}
        </button>
      </form>
    </div>
  )
}

function TgReports() {
  const { t, tErr, lang } = useI18n()
  const { me, signOut, can } = useSession()
  const [key, setKey] = useState<PeriodKey>('today')
  const [tick, setTick] = useState(0)
  const [data, setData] = useState<Summary | null>(null)
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const allowed = can('reports.view')

  useEffect(() => {
    if (!allowed) return
    let stale = false
    const p = PERIODS.find((x) => x.key === key)!.period()
    setBusy(true)
    Promise.all([api<Summary>(`/reports/summary?from=${p.from}&to=${p.to}`), api<ShiftRow[]>(`/reports/shifts?from=${p.from}&to=${p.to}`)])
      .then(([s, sh]) => {
        if (stale) return
        setData(s)
        setShifts(sh)
        setError(null)
      })
      .catch((err) => !stale && setError(tErr(err instanceof ApiError ? err.code : 'internal')))
      .finally(() => !stale && setBusy(false))
    return () => {
      stale = true
    }
  }, [key, tick, allowed, tErr])

  const expenses = useMemo(() => data?.cash.byCategory.filter((c) => c.type === 'expense') ?? [], [data])
  const pick = (k: PeriodKey) => {
    tg()?.HapticFeedback?.impactOccurred('light')
    setKey(k)
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl pb-8">
      <header className="sticky top-0 z-10 bg-slate-900 px-4 pb-3 pt-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{me?.tenant.name}</div>
            <div className="truncate text-xs text-slate-300">{me?.user.name}</div>
          </div>
          <div className="flex shrink-0 gap-2 text-sm">
            <button className="cursor-pointer rounded-lg bg-white/10 px-3 py-1.5" onClick={() => setTick((n) => n + 1)} aria-label={W.refresh[lang]} title={W.refresh[lang]}>
              ↻
            </button>
            <button className="cursor-pointer rounded-lg bg-white/10 px-3 py-1.5" onClick={signOut}>
              {t('signOut')}
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-white/10 p-1 text-sm" role="tablist">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={key === p.key}
              className={`cursor-pointer rounded-lg py-1.5 font-medium ${key === p.key ? 'bg-white text-slate-900' : 'text-slate-200'}`}
              onClick={() => pick(p.key)}
            >
              {W[p.key][lang]}
            </button>
          ))}
        </div>
      </header>

      <main className={`space-y-3 p-3 transition-opacity ${busy && data ? 'opacity-60' : ''}`}>
        {!allowed && <div className="rounded-2xl bg-white p-5 text-center text-sm text-slate-600 ring-1 ring-slate-200">{W.noAccess[lang]}</div>}
        {error && (
          <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
        {allowed && !data && !error && <div className="p-6 text-center text-sm text-slate-500">{t('loading')}</div>}
        {data && (
          <>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm text-slate-500">{t('kRevenue')}</div>
              <div className="text-3xl font-bold tabular-nums tracking-tight">{money(data.totals.revenue)}</div>
              {data.totals.cost > 0 && (
                <div className="mt-1 text-sm text-emerald-700">
                  {W.profit[lang]}: <b className="tabular-nums">{money(data.totals.profit)}</b>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                [t('kReceipts'), String(data.totals.receipts)],
                [t('kAverage'), money(data.totals.average)],
                [t('kGuests'), String(data.totals.guests)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="truncate text-xs text-slate-500">{label}</div>
                  <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            {data.totals.receipts === 0 && <div className="p-3 text-center text-sm text-slate-500">{W.empty[lang]}</div>}

            {data.byMethod.length > 0 && (
              <Section title={W.payments[lang]}>
                {data.byMethod.map((m) => (
                  <Row key={m.id} name={m.name[lang]} value={money(m.amount)} />
                ))}
              </Section>
            )}

            {(data.cash.expense > 0 || data.cash.income > 0 || data.cash.collection > 0) && (
              <Section title={W.cash[lang]}>
                {expenses.map((c, i) => (
                  <Row key={i} name={[c.parent, c.name ?? W.noCategory[lang]].filter(Boolean).join(' → ')} value={'−' + money(c.amount)} />
                ))}
                {data.cash.expense > 0 && <Row name={W.expense[lang]} value={'−' + money(data.cash.expense)} strong />}
                {data.cash.income > 0 && <Row name={W.income[lang]} value={'+' + money(data.cash.income)} strong />}
                {data.cash.collection > 0 && <Row name={W.collection[lang]} value={money(data.cash.collection)} strong />}
              </Section>
            )}

            {data.byProduct.length > 0 && (
              <Section title={W.top[lang]}>
                {data.byProduct.slice(0, 10).map((p, i) => (
                  <Row key={p.productId ?? i} name={`${i + 1}. ${p.name[lang]}`} sub={`${qty(p.qty)} ${W.pcs[lang]}`} value={money(p.amount)} />
                ))}
              </Section>
            )}

            {data.byWaiter.length > 0 && (
              <Section title={W.staff[lang]}>
                {data.byWaiter.map((w) => (
                  <Row key={w.id} name={w.name} sub={`${t('kReceipts')}: ${w.receipts}`} value={money(w.revenue)} />
                ))}
              </Section>
            )}

            {(data.voids.count > 0 || data.totals.discounts > 0) && (
              <Section title="⚠️">
                {data.voids.count > 0 && <Row name={`${W.voids[lang]} (${data.voids.count})`} value={money(data.voids.amount)} />}
                {data.totals.discounts > 0 && <Row name={W.discounts[lang]} value={'−' + money(data.totals.discounts)} />}
              </Section>
            )}

            {shifts.length > 0 && (
              <Section title={W.shifts[lang]}>
                {shifts.map((s) => {
                  const diff = s.countedCash != null && s.expectedCash != null ? s.countedCash - s.expectedCash : null
                  return (
                    <Row
                      key={s.id}
                      name={`${W.shift[lang]} №${s.number}${s.closedAt ? '' : ` · ${W.open[lang]}`}`}
                      sub={`${dateTime(s.openedAt)}${diff ? ` · ${W.diff[lang]}: ${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}` : ''}`}
                      value={money(s.revenue)}
                    />
                  )
                })}
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export function TgApp() {
  useTelegram()
  const { me, loading } = useSession()
  const { t } = useI18n()
  if (loading) return <div className="p-8 text-center text-sm text-slate-500">{t('loading')}</div>
  return me ? <TgReports /> : <TgLogin />
}
