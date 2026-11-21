import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, money, type Receipt, type ShiftSummary } from './api'
import { useApp } from './app'
import { desktop, printSlips, shiftReport } from './print'

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="veil" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg glass" role="dialog" aria-modal="true" aria-label={title}>
        <h2>
          {title}
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </h2>
        {children}
      </div>
    </div>
  )
}

const digits = (v: string, max = 12) => v.replace(/\D/g, '').slice(0, max)

/** Выбор принтера чеков — только в приложении NeoPos Kassa для Windows. */
export function PrinterSetting() {
  const { t, toast, boot } = useApp()
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (!desktop) return
    void desktop.printers().then(setPrinters)
    void desktop.info().then((i) => {
      setCurrent(i?.printer ?? '')
      setVersion(i?.version ?? '')
    })
  }, [])

  if (!desktop || current === null) return null

  async function choose(name: string) {
    setCurrent(name)
    await desktop!.setPrinter(name)
  }

  async function test() {
    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
    const err = await printSlips([
      `<section class="slip"><div class="c big">${boot.venue.replace(/[<>&"]/g, '')}</div><hr /><div class="c">${t('printerTestText')}</div><div class="c small">${now}</div></section>`,
    ])
    toast(err ? `${t('printFailed')}: ${err}` : t('printerTestText'))
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label className="field">
        <span>{t('printer')}</span>
        <select className="input" value={current} onChange={(e) => void choose(e.target.value)}>
          <option value="">{t('printerDefault')}</option>
          {printers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.displayName}
              {p.isDefault ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </label>
      <button className="btn plain wide" onClick={() => void test()}>
        {t('printerTest')}
      </button>
      {version && (
        <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          {t('appVersion')}: {version}
        </div>
      )}
    </div>
  )
}

/** Оплата: нажатие на способ подставляет остаток, для наличных считается сдача. */
export function PayDialog({
  receipt,
  onClose,
  onPaid,
}: {
  receipt: Receipt
  onClose: () => void
  onPaid: (change: number, closed: Receipt) => void
}) {
  const { t, lang, boot, fail } = useApp()
  const methods = boot.paymentMethods
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const total = receipt.total

  const value = (id: string) => Number(amounts[id] || 0)
  const paid = methods.reduce((s, m) => s + value(m.id), 0)
  const diff = paid - total
  const cashPaid = methods.filter((m) => m.kind === 'cash').reduce((s, m) => s + value(m.id), 0)
  const valid = diff >= 0 && diff <= cashPaid && paid > 0

  /** Нажатие на способ оплаты: закрывает им всё, что ещё не покрыто остальными. */
  const fill = (id: string) => {
    const others = paid - value(id)
    const rest = Math.max(0, total - others)
    setAmounts((a) => ({ ...a, [id]: rest ? String(rest) : '' }))
  }

  const cash = methods.find((m) => m.kind === 'cash')
  const quick = cash
    ? [...new Set([10_000, 50_000, 100_000].map((step) => Math.ceil(total / step) * step))].filter((v) => v > total).slice(0, 3)
    : []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    try {
      const payments = methods.map((m) => ({ methodId: m.id, amount: value(m.id) })).filter((p) => p.amount > 0)
      const res = await api<{ change: number; receipt: Receipt }>(`/pos/receipts/${receipt.id}/pay`, {
        method: 'POST',
        body: { payments },
      })
      onPaid(res.change, res.receipt)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('payment')} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <div>
          <div className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
            {t('toPay')}
          </div>
          <div className="big num">
            {money(total)} {t('sum')}
          </div>
        </div>
        {methods.map((m) => (
          <div className="payrow" key={m.id}>
            <button type="button" className={value(m.id) > 0 ? 'on' : ''} onClick={() => fill(m.id)}>
              {m.name[lang]}
            </button>
            <input
              className="input num"
              inputMode="numeric"
              placeholder="0"
              aria-label={m.name[lang]}
              value={amounts[m.id] ?? ''}
              onChange={(e) => setAmounts((a) => ({ ...a, [m.id]: digits(e.target.value) }))}
            />
          </div>
        ))}
        {cash && quick.length > 0 && (
          <div className="quick">
            {quick.map((v) => (
              <button type="button" key={v} onClick={() => setAmounts({ [cash.id]: String(v) })}>
                {money(v)}
              </button>
            ))}
          </div>
        )}
        <div className={`change num ${diff >= 0 ? 'ok' : 'need'}`}>
          {paid === 0 ? '' : diff >= 0 ? `${t('change')}: ${money(diff)}` : `${t('remaining')}: ${money(-diff)}`}
        </div>
        <button className="btn close wide" disabled={!valid || busy}>
          {t('pay')}
        </button>
      </form>
    </Dialog>
  )
}

/** Закрытие смены: итоги и пересчёт наличных. */
export function ShiftDialog({ onClose }: { onClose: () => void }) {
  const { t, lang, boot, can, fail, logout, toast } = useApp()
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [counted, setCounted] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ summary: ShiftSummary | null }>('/pos/shift')
      .then((r) => setSummary(r.summary))
      .catch(fail)
  }, [fail])

  async function close(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/pos/shift/close', { method: 'POST', body: { countedCash: Number(counted) || 0 } })
      logout()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const diff = summary && counted !== '' ? Number(counted) - summary.expectedCash : null

  return (
    <Dialog title={`${t('shift')} №${boot.shift?.number ?? ''}`} onClose={onClose}>
      {!summary ? (
        <div className="muted">{t('loading')}</div>
      ) : (
        <form onSubmit={close} style={{ display: 'grid', gap: 12 }}>
          <div>
            <div className="kv">
              <span>{t('shiftReceipts')}</span>
              <b className="num">{summary.receipts}</b>
            </div>
            {summary.byMethod.map((m) => (
              <div className="kv" key={m.methodId}>
                <span>{m.name[lang]}</span>
                <b className="num">{money(m.amount)}</b>
              </div>
            ))}
            <div className="kv total">
              <span>{t('revenue')}</span>
              <b className="num">{money(summary.revenue)}</b>
            </div>
            <div className="kv">
              <span>{t('openingCash')}</span>
              <span className="num">{money(summary.openingCash)}</span>
            </div>
            {summary.movements.map((m) => (
              <div className="kv" key={m.id}>
                <span>
                  {m.kind === 'out' ? t('cashOut') : t('cashIn')}: {m.note}
                </span>
                <span className="num">
                  {m.kind === 'out' ? '−' : '+'}
                  {money(m.amount)}
                </span>
              </div>
            ))}
            <div className="kv">
              <span>{t('expectedCash')}</span>
              <b className="num">{money(summary.expectedCash)}</b>
            </div>
          </div>
          <button
            type="button"
            className="btn plain wide"
            onClick={() =>
              void printSlips([shiftReport(summary, boot, lang, boot.shift?.number ?? 0)]).then((err) => {
                if (err) toast(`${t('printFailed')}: ${err}`)
              })
            }
          >
            🖨 {t('printReport')}
          </button>
          {can('shift.open_close') &&
            (summary.openReceipts > 0 ? (
              <div className="err">{t('hasOpenReceipts')}</div>
            ) : (
              <>
                <label className="field">
                  <span>
                    {t('countedCash')}, {t('sum')}
                  </span>
                  <input
                    className="input num"
                    inputMode="numeric"
                    required
                    value={counted}
                    onChange={(e) => setCounted(digits(e.target.value))}
                  />
                </label>
                <div className={`change num ${diff === 0 ? 'ok' : 'need'}`}>
                  {diff === null ? '' : `${t('difference')}: ${diff > 0 ? '+' : ''}${money(diff)}`}
                </div>
                <button className="btn danger wide" disabled={busy}>
                  {t('closeShift')}
                </button>
              </>
            ))}
        </form>
      )}
    </Dialog>
  )
}
