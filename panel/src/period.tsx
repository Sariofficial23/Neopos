import { useI18n, type Key } from './i18n'

/** Время заведения — Ташкент (UTC+5, без летнего времени). */
const TZ = 'Asia/Tashkent'
const TZ_MS = 5 * 3600_000

/** Дата «сегодня минус N дней» по времени заведения, в виде ГГГГ-ММ-ДД. */
export const dayAgo = (n: number) => new Date(Date.now() + TZ_MS - n * 86_400_000).toISOString().slice(0, 10)

export type Period = { from: string; to: string }
export const todayPeriod = (): Period => ({ from: dayAgo(0), to: dayAgo(0) })

export const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'
export const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

const PRESETS: { key: Key; from: number; to: number }[] = [
  { key: 'pToday', from: 0, to: 0 },
  { key: 'pYesterday', from: 1, to: 1 },
  { key: 'p7', from: 6, to: 0 },
  { key: 'p30', from: 29, to: 0 },
]

/** Выбор периода: быстрые кнопки и две даты. Один на страницу, стоит над данными. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-200/70 p-1">
        {PRESETS.map((p) => {
          const on = value.from === dayAgo(p.from) && value.to === dayAgo(p.to)
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ from: dayAgo(p.from), to: dayAgo(p.to) })}
              className={`cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t(p.key)}
            </button>
          )
        })}
      </div>
      <input
        type="date"
        className="input w-auto"
        aria-label={t('pFrom')}
        value={value.from}
        max={value.to}
        onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
      />
      <span className="text-slate-400">—</span>
      <input
        type="date"
        className="input w-auto"
        aria-label={t('pTo')}
        value={value.to}
        min={value.from}
        max={dayAgo(0)}
        onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
      />
    </div>
  )
}
