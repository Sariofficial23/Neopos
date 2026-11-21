import { useEffect, type ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {text}
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'green' | 'slate' | 'brand'; children: ReactNode }) {
  const cls = {
    green: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-50 text-brand-700',
  }[tone]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        checked ? 'bg-brand-50/60' : 'bg-slate-50'
      } ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-brand-50'}`}
    >
      <span className={checked ? 'font-medium text-slate-900' : 'text-slate-600'}>{label}</span>
      {/* Настоящий чекбокс остаётся для клавиатуры и экранных читалок, виден только переключатель */}
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors duration-200 peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-md after:transition-transform after:duration-200 after:content-[''] peer-checked:after:translate-x-5"
      />
    </label>
  )
}

/** Сегментный переключатель вкладок в духе iOS. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div role="tablist" className="inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-200/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium transition ${
            value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Переключатель без подписи — для строк таблицы. Подпись передаётся для экранных читалок. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  tone = 'green',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  tone?: 'green' | 'red'
}) {
  return (
    <label className={`inline-flex ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-md after:transition-transform after:duration-200 after:content-[''] peer-checked:after:translate-x-5 ${
          tone === 'red' ? 'peer-checked:bg-rose-500' : 'peer-checked:bg-emerald-500'
        }`}
      />
    </label>
  )
}

export const TILE_COLORS = ['#e8590c', '#c92a2a', '#2f9e44', '#b7791f', '#1c7ed6', '#9c36b5', '#0c8599', '#495057']
