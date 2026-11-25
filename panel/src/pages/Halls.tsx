import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api, ApiError, type Hall, type Table } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Field, Modal } from '../ui'

type HallDraft = { id?: string; name: string; service: string }
type TableDraft = { id?: string; name: string; seats: string; service: string }
type BulkDraft = { from: string; to: string; seats: string }
type Place = Pick<Table, 'x' | 'y' | 'w' | 'h' | 'shape'>

/** Процент из сотых долей: 1000 → «10», 750 → «7.5» */
const bpText = (bp: number | null) => (bp == null ? '' : String(bp / 100))
/** Поле процента: цифры и одна точка, не больше 100 */
const percentInput = (v: string) => {
  const [whole, ...rest] = v.replace(',', '.').replace(/[^\d.]/g, '').split('.')
  const clean = (rest.length ? `${whole}.${rest.join('')}` : whole).slice(0, 5)
  return Number(clean) > 100 ? '100' : clean
}
const percentValue = (v: string) => (v === '' ? null : Number(v))
const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max)

/** Сетка плана зала, как в Clopos: 24 клетки в ширину, стол по умолчанию 2 × 2. */
const COLS = 24
const MAX_ROWS = 40
const CELL = 34

/** Столы, которые ещё никто не расставлял (все в левом верхнем углу), раскладываем рядами по восемь. */
function arranged(list: Table[]): Table[] {
  const untouched = list.length > 1 && list.every((t) => t.x === 0 && t.y === 0)
  if (!untouched && !(list.length === 1 && list[0].w === 1 && list[0].h === 1)) return list
  return list.map((t, i) => ({ ...t, x: (i % 8) * 3, y: Math.floor(i / 8) * 3, w: 2, h: 2 }))
}

export function HallsPage() {
  const { t, tErr } = useI18n()
  const [halls, setHalls] = useState<Hall[] | null>(null)
  /** Зал, у которого открыт план столов; null — список залов */
  const [manageId, setManageId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [hDraft, setHDraft] = useState<HallDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      setHalls(await api<Hall[]>('/halls'))
      setPageError(null)
    } catch (err) {
      setPageError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  async function saveHall(e: FormEvent) {
    e.preventDefault()
    if (!hDraft) return
    setBusy(true)
    setError(null)
    try {
      const body = { name: hDraft.name, servicePercent: percentValue(hDraft.service) }
      if (hDraft.id) await api(`/halls/${hDraft.id}`, { method: 'PATCH', body })
      else await api('/halls', { method: 'POST', body })
      setHDraft(null)
      await load()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeHall() {
    if (!hDraft?.id || !window.confirm(t('confirmDelete'))) return
    setBusy(true)
    try {
      await api(`/halls/${hDraft.id}`, { method: 'DELETE' })
      setHDraft(null)
      await load()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  /** «Настроить порядок залов»: стрелки двигают зал вверх и вниз, порядок сразу уходит на кассу. */
  async function move(index: number, dir: -1 | 1) {
    if (!halls) return
    const next = [...halls]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    setHalls(next)
    try {
      await api('/halls/order', { method: 'POST', body: { ids: next.map((h) => h.id) } })
    } catch (err) {
      setPageError(errText(err))
      await load()
    }
  }

  const manage = halls?.find((h) => h.id === manageId)
  if (manage) return <HallPlan hall={manage} onBack={() => setManageId(null)} onChanged={load} />

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('navHalls')}</h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setError(null)
            setHDraft({ name: '', service: '' })
          }}
        >
          + {t('addHall')}
        </button>
      </div>
      <ErrorNote text={pageError} />
      {!halls && !pageError && <div className="text-sm text-slate-500">{t('loading')}</div>}

      {halls && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('hallName')}</th>
                <th className="px-4 py-3 font-medium">{t('servicePercent')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('hlTables')}</th>
                <th className="px-4 py-3 font-medium" />
                <th className="px-4 py-3 text-center font-medium">{t('hlOrder')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {halls.map((h, i) => (
                <tr key={h.id}>
                  <td className="px-4 py-3 font-medium">{h.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{h.serviceBp == null ? t('hlDefault') : `${bpText(h.serviceBp)}%`}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{h.tables.length}</td>
                  <td className="px-4 py-3">
                    <button className="cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => setManageId(h.id)}>
                      {t('hlManage')}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button className="cursor-pointer px-2 text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={i === 0} aria-label={t('hlUp')} onClick={() => void move(i, -1)}>
                      ↑
                    </button>
                    <button className="cursor-pointer px-2 text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={i === halls.length - 1} aria-label={t('hlDown')} onClick={() => void move(i, 1)}>
                      ↓
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
                      onClick={() => {
                        setError(null)
                        setHDraft({ id: h.id, name: h.name, service: bpText(h.serviceBp) })
                      }}
                    >
                      {t('edit')}
                    </button>
                  </td>
                </tr>
              ))}
              {halls.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    {t('noHalls')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {hDraft && (
        <Modal title={hDraft.id ? t('editHall') : t('addHall')} onClose={() => setHDraft(null)}>
          <form onSubmit={saveHall} className="space-y-4">
            <Field label={t('hallName')}>
              <input className="input" autoFocus required maxLength={60} value={hDraft.name} onChange={(e) => setHDraft({ ...hDraft, name: e.target.value })} />
            </Field>
            <Field label={`${t('servicePercent')}, %`} hint={t('hlServiceHint')}>
              <input className="input tabular-nums" inputMode="decimal" placeholder={t('hlDefault')} value={hDraft.service} onChange={(e) => setHDraft({ ...hDraft, service: percentInput(e.target.value) })} />
            </Field>
            <ErrorNote text={error} />
            <div className="flex items-center justify-between gap-3 pt-1">
              {hDraft.id ? (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeHall()}>
                  {t('delete')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setHDraft(null)}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" disabled={busy}>
                  {t('save')}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

/**
 * План зала, как «Управление столами» в Clopos: столы стоят на сетке, их перетаскивают мышью или пальцем.
 * Расстановка сохраняется кнопкой «Сохранить» и так же показывается на кассе.
 */
function HallPlan({ hall, onBack, onChanged }: { hall: Hall; onBack: () => void; onChanged: () => Promise<void> }) {
  const { t, tErr } = useI18n()
  const [list, setList] = useState<Table[]>(() => arranged(hall.tables))
  const [dirty, setDirty] = useState(() => arranged(hall.tables) !== hall.tables)
  const [selected, setSelected] = useState<string | null>(null)
  const [tDraft, setTDraft] = useState<TableDraft | null>(null)
  const [bulk, setBulk] = useState<BulkDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const board = useRef<HTMLDivElement>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  // Столы добавили или убрали — берём свежий список, сохраняя уже сделанную, но не сохранённую расстановку.
  useEffect(() => {
    setList((cur) => {
      const mine = new Map(cur.map((x) => [x.id, x]))
      return arranged(hall.tables.map((x) => (mine.has(x.id) ? { ...x, ...place(mine.get(x.id)!) } : x)))
    })
  }, [hall.tables])

  const rows = Math.min(MAX_ROWS, Math.max(14, ...list.map((x) => x.y + x.h + 3)))
  const sel = list.find((x) => x.id === selected) ?? null

  const patch = (id: string, p: Partial<Place>) => {
    setList((cur) => cur.map((x) => (x.id === id ? { ...x, ...clamp({ ...place(x), ...p }) } : x)))
    setDirty(true)
    setNote(null)
  }

  function down(e: ReactPointerEvent, tb: Table) {
    const rect = board.current!.getBoundingClientRect()
    drag.current = { id: tb.id, dx: e.clientX - rect.left - tb.x * CELL, dy: e.clientY - rect.top - tb.y * CELL, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSelected(tb.id)
  }
  function moveTo(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const rect = board.current!.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left - d.dx) / CELL)
    const y = Math.round((e.clientY - rect.top - d.dy) / CELL)
    const cur = list.find((q) => q.id === d.id)
    if (!cur || (cur.x === x && cur.y === y)) return
    d.moved = true
    patch(d.id, { x, y })
  }

  async function run(action: () => Promise<unknown>, done?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      done?.()
      await onChanged()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(
      () => api(`/halls/${hall.id}/layout`, { method: 'PUT', body: { tables: list.map((x) => ({ id: x.id, ...place(x) })) } }),
      () => {
        setDirty(false)
        setNote(t('hlSaved'))
      },
    )

  /** Следующий свободный номер стола — чтобы не вводить его руками. */
  const nextNumber = () => {
    const nums = list.map((x) => Number(x.name)).filter((n) => Number.isInteger(n) && n > 0)
    return (nums.length ? Math.max(...nums) : 0) + 1
  }

  function saveTable(e: FormEvent) {
    e.preventDefault()
    if (!tDraft) return
    const body = { hallId: hall.id, name: tDraft.name, seats: Number(tDraft.seats) || 1, servicePercent: percentValue(tDraft.service) }
    void run(
      () => (tDraft.id ? api(`/tables/${tDraft.id}`, { method: 'PATCH', body }) : api('/tables', { method: 'POST', body })),
      () => setTDraft(null),
    )
  }

  function saveBulk(e: FormEvent) {
    e.preventDefault()
    if (!bulk) return
    void run(
      () => api('/tables/bulk', { method: 'POST', body: { hallId: hall.id, from: Number(bulk.from), to: Number(bulk.to), seats: Number(bulk.seats) || 1 } }),
      () => setBulk(null),
    )
  }

  /** «Дубликат»: такой же стол со следующим номером, рядом с исходным. */
  const duplicate = (tb: Table) =>
    run(() =>
      api('/tables', {
        method: 'POST',
        body: { hallId: hall.id, name: String(nextNumber()), seats: tb.seats, servicePercent: tb.serviceBp == null ? null : tb.serviceBp / 100, w: tb.w, h: tb.h, shape: tb.shape },
      }),
    )

  const removeTable = (id: string) => {
    if (window.confirm(t('confirmDelete'))) void run(() => api(`/tables/${id}`, { method: 'DELETE' }), () => setSelected(null))
  }

  const clearAll = () => {
    if (window.confirm(t('hlClearConfirm'))) void run(() => api(`/halls/${hall.id}/tables`, { method: 'DELETE' }), () => setSelected(null))
  }

  const sizeBtn = (label: string, p: Partial<Place>, on: boolean) => (
    <button type="button" className={`btn ${on ? 'btn-primary' : 'btn-ghost'} h-9 px-3`} onClick={() => sel && patch(sel.id, p)}>
      {label}
    </button>
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          <button className="cursor-pointer text-brand-600 hover:underline" onClick={onBack}>
            {t('navHalls')}
          </button>{' '}
          <span className="text-slate-400">/</span> {hall.name}
        </h1>
        <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          ✓ {t('save')}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost" onClick={() => void clearAll()} disabled={busy || !list.length}>
          {t('hlClear')}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setError(null)
            setBulk({ from: String(nextNumber()), to: String(nextNumber() + 9), seats: '4' })
          }}
        >
          ⊞ {t('addTables')}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setError(null)
            setTDraft({ name: String(nextNumber()), seats: '4', service: '' })
          }}
        >
          + {t('addTable')}
        </button>
        {dirty && <span className="text-sm font-medium text-amber-700">{t('hlUnsaved')}</span>}
        {note && !dirty && <span className="text-sm font-medium text-emerald-700">{note}</span>}
      </div>
      <ErrorNote text={tDraft || bulk ? null : error} />

      {sel && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 p-3 text-sm">
          <b className="mr-2">
            {t('table')} {sel.name}
          </b>
          <button className="btn btn-ghost h-9 px-3" onClick={() => setTDraft({ id: sel.id, name: sel.name, seats: String(sel.seats), service: bpText(sel.serviceBp) })}>
            {t('edit')}
          </button>
          <button className="btn btn-ghost h-9 px-3" disabled={busy} onClick={() => void duplicate(sel)}>
            {t('hlDuplicate')}
          </button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          {sizeBtn('▢', { w: 2, h: 2, shape: 'rect' }, sel.shape === 'rect' && sel.w === 2 && sel.h === 2)}
          {sizeBtn('▭', { w: 4, h: 2, shape: 'rect' }, sel.shape === 'rect' && sel.w === 4)}
          {sizeBtn('▯', { w: 2, h: 4, shape: 'rect' }, sel.shape === 'rect' && sel.h === 4)}
          {sizeBtn('◯', { w: 2, h: 2, shape: 'round' }, sel.shape === 'round')}
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button className="btn btn-danger h-9 px-3" disabled={busy} onClick={() => removeTable(sel.id)}>
            {t('delete')}
          </button>
        </div>
      )}

      <div className="card overflow-auto p-3">
        <div
          ref={board}
          className="relative mx-auto touch-none select-none"
          style={{
            width: COLS * CELL,
            height: rows * CELL,
            backgroundImage: 'linear-gradient(#eef0f6 1px, transparent 1px), linear-gradient(90deg, #eef0f6 1px, transparent 1px)',
            backgroundSize: `${CELL / 2}px ${CELL / 2}px`,
          }}
          onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          {list.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onPointerDown={(e) => down(e, tb)}
              onPointerMove={moveTo}
              onPointerUp={() => (drag.current = null)}
              onDoubleClick={() => setTDraft({ id: tb.id, name: tb.name, seats: String(tb.seats), service: bpText(tb.serviceBp) })}
              className={`absolute flex cursor-grab flex-col items-center justify-center p-1 text-center text-xs font-semibold text-white shadow-md active:cursor-grabbing ${
                tb.shape === 'round' ? 'rounded-full' : 'rounded-md'
              } ${selected === tb.id ? 'bg-brand-600 ring-2 ring-brand-500 ring-offset-2' : 'bg-slate-500'}`}
              style={{ left: tb.x * CELL + 2, top: tb.y * CELL + 2, width: tb.w * CELL - 4, height: tb.h * CELL - 4 }}
            >
              <span className="max-w-full truncate">
                {t('table')} {tb.name}
              </span>
              {tb.serviceBp != null && <span className="text-[10px] font-normal opacity-90">{bpText(tb.serviceBp)}%</span>}
            </button>
          ))}
          {list.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">{t('noTables')}</div>}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t('hlPlanHint')}</p>

      {tDraft && (
        <Modal title={tDraft.id ? t('edit') : t('addTable')} onClose={() => setTDraft(null)}>
          <form onSubmit={saveTable} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('tableName')}>
                <input className="input" autoFocus required maxLength={30} value={tDraft.name} onChange={(e) => setTDraft({ ...tDraft, name: e.target.value })} />
              </Field>
              <Field label={t('seats')}>
                <input className="input" inputMode="numeric" required value={tDraft.seats} onChange={(e) => setTDraft({ ...tDraft, seats: digits(e.target.value, 2) })} />
              </Field>
            </div>
            <Field label={`${t('servicePercent')}, %`} hint={t('hlTableServiceHint')}>
              <input className="input tabular-nums" inputMode="decimal" placeholder={hall.serviceBp == null ? t('hlDefault') : `${bpText(hall.serviceBp)}%`} value={tDraft.service} onChange={(e) => setTDraft({ ...tDraft, service: percentInput(e.target.value) })} />
            </Field>
            <ErrorNote text={error} />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost" onClick={() => setTDraft(null)}>
                {t('cancel')}
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {t('save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {bulk && (
        <Modal title={t('addTables')} onClose={() => setBulk(null)}>
          <form onSubmit={saveBulk} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('from')}>
                <input className="input" inputMode="numeric" autoFocus required value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: digits(e.target.value, 4) })} />
              </Field>
              <Field label={t('to')}>
                <input className="input" inputMode="numeric" required value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: digits(e.target.value, 4) })} />
              </Field>
              <Field label={t('seats')}>
                <input className="input" inputMode="numeric" required value={bulk.seats} onChange={(e) => setBulk({ ...bulk, seats: digits(e.target.value, 2) })} />
              </Field>
            </div>
            <ErrorNote text={error} />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost" onClick={() => setBulk(null)}>
                {t('cancel')}
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {t('save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

const place = (t: Place): Place => ({ x: t.x, y: t.y, w: t.w, h: t.h, shape: t.shape })
/** Стол не выходит за края плана. */
const clamp = (p: Place): Place => ({
  ...p,
  x: Math.max(0, Math.min(COLS - p.w, p.x)),
  y: Math.max(0, Math.min(MAX_ROWS - p.h, p.y)),
})
