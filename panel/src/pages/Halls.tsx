import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type Hall, type Table } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote, Field, Modal, Segmented } from '../ui'

type HallDraft = { id?: string; name: string }
type TableDraft = { id?: string; name: string; seats: string }
type BulkDraft = { from: string; to: string; seats: string }

export function HallsPage() {
  const { t, tErr } = useI18n()
  const [halls, setHalls] = useState<Hall[] | null>(null)
  const [hallId, setHallId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [hDraft, setHDraft] = useState<HallDraft | null>(null)
  const [tDraft, setTDraft] = useState<TableDraft | null>(null)
  const [bulk, setBulk] = useState<BulkDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      const list = await api<Hall[]>('/halls')
      setHalls(list)
      setHallId((cur) => (cur && list.some((h) => h.id === cur) ? cur : (list[0]?.id ?? null)))
      setPageError(null)
    } catch (err) {
      setPageError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
  }, [load])

  const hall = halls?.find((h) => h.id === hallId) ?? null

  async function run(action: () => Promise<unknown>, close: () => void) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      close()
      await load()
      return result
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  function saveHall(e: FormEvent) {
    e.preventDefault()
    if (!hDraft) return
    const body = { name: hDraft.name }
    void run(
      async () => {
        if (hDraft.id) return api(`/halls/${hDraft.id}`, { method: 'PATCH', body })
        const created = await api<Hall>('/halls', { method: 'POST', body })
        setHallId(created.id)
      },
      () => setHDraft(null),
    )
  }

  function saveTable(e: FormEvent) {
    e.preventDefault()
    if (!tDraft || !hall) return
    const body = { hallId: hall.id, name: tDraft.name, seats: Number(tDraft.seats) || 1 }
    void run(
      () => (tDraft.id ? api(`/tables/${tDraft.id}`, { method: 'PATCH', body }) : api('/tables', { method: 'POST', body })),
      () => setTDraft(null),
    )
  }

  function saveBulk(e: FormEvent) {
    e.preventDefault()
    if (!bulk || !hall) return
    const body = { hallId: hall.id, from: Number(bulk.from), to: Number(bulk.to), seats: Number(bulk.seats) || 1 }
    void run(() => api('/tables/bulk', { method: 'POST', body }), () => setBulk(null))
  }

  const remove = (path: string, close: () => void) => {
    if (window.confirm(t('confirmDelete'))) void run(() => api(path, { method: 'DELETE' }), close)
  }

  const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max)

  const footer = (onDelete: (() => void) | null, onCancel: () => void) => (
    <div className="flex items-center justify-between gap-3 pt-1">
      {onDelete ? (
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>
          {t('delete')}
        </button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {t('save')}
        </button>
      </div>
    </div>
  )

  /** Следующий свободный номер стола — чтобы не вводить его руками. */
  const nextNumber = (list: Table[]) => {
    const nums = list.map((x) => Number(x.name)).filter((n) => Number.isInteger(n) && n > 0)
    return String((nums.length ? Math.max(...nums) : 0) + 1)
  }

  const open = (fn: () => void) => {
    setError(null)
    fn()
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('navHalls')}</h1>
        <button className="btn btn-primary" onClick={() => open(() => setHDraft({ name: '' }))}>
          + {t('addHall')}
        </button>
      </div>
      <ErrorNote text={pageError} />
      {!halls && !pageError && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {halls?.length === 0 && <div className="card p-10 text-center text-sm text-slate-500">{t('noHalls')}</div>}

      {halls && halls.length > 0 && hall && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              value={hall.id}
              onChange={setHallId}
              options={halls.map((h) => ({ value: h.id, label: `${h.name} · ${h.tables.length}` }))}
            />
            <button
              className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
              onClick={() => open(() => setHDraft({ id: hall.id, name: hall.name }))}
            >
              {t('editHall')}
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => open(() => setTDraft({ name: nextNumber(hall.tables), seats: '4' }))}
            >
              + {t('addTable')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() =>
                open(() => {
                  const from = Number(nextNumber(hall.tables))
                  setBulk({ from: String(from), to: String(from + 9), seats: '4' })
                })
              }
            >
              + {t('addTables')}
            </button>
          </div>

          {hall.tables.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-500">{t('noTables')}</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {hall.tables.map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => open(() => setTDraft({ id: tb.id, name: tb.name, seats: String(tb.seats) }))}
                  className="card flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 p-2 transition hover:border-brand-500 hover:shadow-md"
                >
                  <span className="max-w-full truncate text-xl font-bold">{tb.name}</span>
                  <span className="text-xs text-slate-500">
                    {t('seats')}: {tb.seats}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {hDraft && (
        <Modal title={hDraft.id ? t('editHall') : t('addHall')} onClose={() => setHDraft(null)}>
          <form onSubmit={saveHall} className="space-y-4">
            <Field label={t('hallName')}>
              <input
                className="input"
                autoFocus
                required
                maxLength={60}
                value={hDraft.name}
                onChange={(e) => setHDraft({ ...hDraft, name: e.target.value })}
              />
            </Field>
            <ErrorNote text={error} />
            {footer(hDraft.id ? () => remove(`/halls/${hDraft.id}`, () => setHDraft(null)) : null, () => setHDraft(null))}
          </form>
        </Modal>
      )}

      {tDraft && (
        <Modal title={tDraft.id ? t('edit') : t('addTable')} onClose={() => setTDraft(null)}>
          <form onSubmit={saveTable} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('tableName')}>
                <input
                  className="input"
                  autoFocus
                  required
                  maxLength={30}
                  value={tDraft.name}
                  onChange={(e) => setTDraft({ ...tDraft, name: e.target.value })}
                />
              </Field>
              <Field label={t('seats')}>
                <input
                  className="input"
                  inputMode="numeric"
                  required
                  value={tDraft.seats}
                  onChange={(e) => setTDraft({ ...tDraft, seats: digits(e.target.value, 2) })}
                />
              </Field>
            </div>
            <ErrorNote text={error} />
            {footer(tDraft.id ? () => remove(`/tables/${tDraft.id}`, () => setTDraft(null)) : null, () => setTDraft(null))}
          </form>
        </Modal>
      )}

      {bulk && (
        <Modal title={t('addTables')} onClose={() => setBulk(null)}>
          <form onSubmit={saveBulk} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('from')}>
                <input
                  className="input"
                  inputMode="numeric"
                  autoFocus
                  required
                  value={bulk.from}
                  onChange={(e) => setBulk({ ...bulk, from: digits(e.target.value, 4) })}
                />
              </Field>
              <Field label={t('to')}>
                <input
                  className="input"
                  inputMode="numeric"
                  required
                  value={bulk.to}
                  onChange={(e) => setBulk({ ...bulk, to: digits(e.target.value, 4) })}
                />
              </Field>
              <Field label={t('seats')}>
                <input
                  className="input"
                  inputMode="numeric"
                  required
                  value={bulk.seats}
                  onChange={(e) => setBulk({ ...bulk, seats: digits(e.target.value, 2) })}
                />
              </Field>
            </div>
            <ErrorNote text={error} />
            {footer(null, () => setBulk(null))}
          </form>
        </Modal>
      )}
    </div>
  )
}
