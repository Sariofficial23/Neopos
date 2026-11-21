import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from './api'
import { useApp } from './app'
import { Dialog, ShiftDialog } from './Dialogs'
import { ensureSlipPreviewStyles, periodReport, printSlips, REPORT_TYPES, reportTypeName, tashkentTime, type PeriodSummary, type ReportType } from './print'

type ShiftRow = { id: string; number: number; openedAt: string; closedAt: string | null }

/** Дата в Ташкенте в виде YYYY-MM-DD со сдвигом на `days` дней. */
const tashkentDay = (days = 0, from = new Date()) =>
  new Date(from.getTime() + 5 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10)
/** Местное время заведения → момент времени для сервера. */
const toIso = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:00`).toISOString()
const HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
/** Рабочий день начинается в 06:00: ночные продажи после полуночи относятся к прошлому дню. */
const DAY_START = '06:00'

/**
 * «Создать отчёт», как в Clopos: период «С этой даты — до этой даты» со временем или одна смена,
 * затем тип отчёта. Результат показывается лентой чека и печатается тем же видом.
 */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  const { t, lang, boot, can, fail } = useApp()
  // До 06:00 по Ташкенту ещё идёт вчерашний рабочий день.
  const nowHour = new Date(Date.now() + 5 * 3_600_000).getUTCHours()
  const startDay = tashkentDay(nowHour < 6 ? -1 : 0)
  const [mode, setMode] = useState<'period' | 'shift'>('period')
  const [fromDay, setFromDay] = useState(startDay)
  const [fromTime, setFromTime] = useState(DAY_START)
  const [toDay, setToDay] = useState(tashkentDay(1, new Date(`${startDay}T12:00:00+05:00`)))
  const [toTime, setToTime] = useState(DAY_START)
  const [shiftList, setShiftList] = useState<ShiftRow[] | null>(null)
  const [shiftId, setShiftId] = useState('')
  const [type, setType] = useState<ReportType>('standard')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ html: string } | null>(null)
  const [closingShift, setClosingShift] = useState(false)

  useEffect(() => {
    if (mode !== 'shift' || shiftList) return
    api<ShiftRow[]>('/pos/report/shifts')
      .then((rows) => {
        setShiftList(rows)
        setShiftId((cur) => cur || rows[0]?.id || '')
      })
      .catch(fail)
  }, [mode, shiftList, fail])

  const shiftLabel = (s: ShiftRow) =>
    `№${s.number} · ${tashkentTime(s.openedAt)} — ${s.closedAt ? tashkentTime(s.closedAt).slice(-5) : t('shiftOpenNow')}`

  const periodOk = mode === 'shift' ? !!shiftId : toIso(fromDay, fromTime) < toIso(toDay, toTime)

  async function build(e: FormEvent) {
    e.preventDefault()
    if (!periodOk) return
    setBusy(true)
    try {
      const qs =
        mode === 'shift'
          ? `shiftId=${shiftId}`
          : `from=${encodeURIComponent(toIso(fromDay, fromTime))}&to=${encodeURIComponent(toIso(toDay, toTime))}`
      const data = await api<PeriodSummary>(`/pos/report?${qs}`)
      const shift = shiftList?.find((s) => s.id === shiftId)
      const period =
        mode === 'shift' && shift
          ? [`${t('shift')} ${shiftLabel(shift)}`]
          : [`${tashkentTime(toIso(fromDay, fromTime))} —`, tashkentTime(toIso(toDay, toTime))]
      ensureSlipPreviewStyles()
      setResult({ html: periodReport(data, type, boot, lang, period) })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function print() {
    if (!result) return
    const err = await printSlips([result.html])
    if (err) fail(new Error(err))
  }

  const typeOptions = useMemo(() => REPORT_TYPES.map((k) => ({ k, label: reportTypeName(k, lang) })), [lang])

  if (closingShift) return <ShiftDialog onClose={onClose} />

  if (result)
    return (
      <Dialog title={reportTypeName(type, lang)} onClose={onClose}>
        <div className="slip-preview report-paper" dangerouslySetInnerHTML={{ __html: result.html }} />
        <div className="report-actions">
          <button className="btn" type="button" onClick={() => setResult(null)}>
            ← {t('backShort')}
          </button>
          <button className="btn send" type="button" onClick={() => void print()}>
            {t('print')}
          </button>
        </div>
      </Dialog>
    )

  return (
    <Dialog title={t('report')} onClose={onClose}>
      <form onSubmit={build} style={{ display: 'grid', gap: 14 }}>
        <div className="seg" role="radiogroup" aria-label={t('report')}>
          {(['period', 'shift'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
              {t(k === 'period' ? 'byDate' : 'byShift')}
            </button>
          ))}
        </div>

        {mode === 'period' ? (
          <>
            <div className="field">
              <span>{t('fromDate')}</span>
              <div className="date-time">
                <input className="input" type="date" required value={fromDay} onChange={(e) => setFromDay(e.target.value)} aria-label={t('fromDate')} />
                <select className="input" value={fromTime} onChange={(e) => setFromTime(e.target.value)} aria-label={t('fromDate')}>
                  {HOURS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <span>{t('toDate')}</span>
              <div className="date-time">
                <input className="input" type="date" required value={toDay} onChange={(e) => setToDay(e.target.value)} aria-label={t('toDate')} />
                <select className="input" value={toTime} onChange={(e) => setToTime(e.target.value)} aria-label={t('toDate')}>
                  {HOURS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>
            {!periodOk && <div className="note-box">{t('badPeriod')}</div>}
          </>
        ) : (
          <label className="field">
            <span>{t('shift')}</span>
            <select className="input" required value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              {!shiftList && <option value="">{t('loading')}</option>}
              {shiftList?.length === 0 && <option value="">{t('noShifts')}</option>}
              {shiftList?.map((s) => (
                <option key={s.id} value={s.id}>
                  {shiftLabel(s)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>{t('reportType')}</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ReportType)}>
            {typeOptions.map((o) => (
              <option key={o.k} value={o.k}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <button className="btn send wide" disabled={busy || !periodOk}>
          {busy ? t('loading') : t('cpReport')}
        </button>
        {can('shift.open_close') && boot.shift && (
          <button type="button" className="btn wide" onClick={() => setClosingShift(true)}>
            {t('currentShift')}
          </button>
        )}
      </form>
    </Dialog>
  )
}
