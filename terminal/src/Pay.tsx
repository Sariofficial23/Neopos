import { useEffect, useState } from 'react'
import { api, money, type Receipt } from './api'
import { useApp } from './app'

/**
 * Закрытие счёта на весь экран, как в Clopos: слева «Расчёт сдачи» и цифровая клавиатура,
 * справа «К оплате», строки способов оплаты, переключатель печати чека и кнопка «Закрыть».
 * По умолчанию вся сумма стоит наличными.
 */
export function PayScreen({
  receipt,
  onBack,
  onPaid,
}: {
  receipt: Receipt
  onBack: () => void
  onPaid: (change: number, closed: Receipt, printReceipt: boolean) => void
}) {
  const { t, lang, boot, fail } = useApp()
  const methods = boot.paymentMethods
  const total = receipt.total
  const cash = methods.find((m) => m.kind === 'cash')
  const first = cash ?? methods[0]
  const [amounts, setAmounts] = useState<Record<string, string>>(() => (first && total > 0 ? { [first.id]: String(total) } : {}))
  const [active, setActive] = useState<string>(first?.id ?? '')
  // Первая цифра после выбора строки заменяет сумму, следующие — дописываются.
  const [fresh, setFresh] = useState(true)
  const [printIt, setPrintIt] = useState(boot.print.receipt)
  const [busy, setBusy] = useState(false)

  const value = (id: string) => Number(amounts[id] || 0)
  const paid = methods.reduce((s, m) => s + value(m.id), 0)
  const diff = paid - total
  const cashPaid = methods.filter((m) => m.kind === 'cash').reduce((s, m) => s + value(m.id), 0)
  // Сдачу дают только с наличных: картой нельзя заплатить больше суммы чека.
  const valid = diff >= 0 && diff <= cashPaid && paid > 0

  // Наличные и карта всегда стоят строками; остальные способы — кнопками, пока по ним нет суммы.
  const isRow = (m: (typeof methods)[number]) => m.kind === 'cash' || m.kind === 'card' || value(m.id) > 0 || m.id === active
  const rows = methods.filter(isRow)
  const buttons = methods.filter((m) => !isRow(m))

  /** Выбор способа: на него переходит всё, что ещё не покрыто остальными. */
  function pick(id: string) {
    const others = paid - value(id)
    if (others >= total) setAmounts({ [id]: String(total) })
    else if (!value(id)) setAmounts((a) => ({ ...a, [id]: String(Math.max(0, total - others)) }))
    setActive(id)
    setFresh(true)
  }

  function key(k: string) {
    if (!active) return
    setAmounts((a) => {
      const cur = fresh ? '' : (a[active] ?? '')
      const next = k === 'back' ? (a[active] ?? '').slice(0, -1) : (cur + k).replace(/^0+(?=[0-9])/, '').slice(0, 12)
      return { ...a, [active]: next }
    })
    setFresh(false)
  }

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    try {
      const payments = methods.map((m) => ({ methodId: m.id, amount: value(m.id) })).filter((p) => p.amount > 0)
      const res = await api<{ change: number; receipt: Receipt }>(`/pos/receipts/${receipt.id}/pay`, { method: 'POST', body: { payments } })
      onPaid(res.change, res.receipt, printIt)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  // Клавиатура компьютера: цифры, Backspace, Enter — закрыть, Esc — назад.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) key(e.key)
      else if (e.key === 'Backspace') key('back')
      else if (e.key === 'Enter') void submit()
      else if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <header className="bar">
        <button className="ico" onClick={onBack} title={t('back')} aria-label={t('back')}>
          <svg viewBox="0 0 24 24">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <strong className="bar-title">{t('payment')}</strong>
        <span className="bar-meta num">№{receipt.number}</span>
      </header>

      <div className="pay">
        <section className="pay-left">
          <div className={`pay-change num ${diff < 0 ? 'need' : ''}`}>
            <span>{diff < 0 ? t('remaining') : t('changeCalc')}</span>
            <b>
              {money(Math.abs(diff))} {t('sum')}
            </b>
          </div>
          <div className="pay-pad">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d) => (
              <button key={d} onClick={() => key(d)}>
                {d}
              </button>
            ))}
            <button onClick={() => key('00')}>00</button>
            <button onClick={() => key('0')}>0</button>
            <button aria-label="Backspace" onClick={() => key('back')}>
              ⌫
            </button>
          </div>
        </section>

        <section className="pay-right">
          <div className="pay-total">
            <span>{t('toPay')}</span>
            <b className="num">
              {money(total)} {t('sum')}
            </b>
          </div>

          <div className="pay-rows">
            {rows.map((m) => (
              <button key={m.id} className={`pay-row ${m.id === active ? 'on' : ''}`} onClick={() => pick(m.id)}>
                <span>{m.name[lang]}</span>
                <b className="num">
                  {money(value(m.id))} {t('sum')}
                </b>
              </button>
            ))}
          </div>

          {buttons.length > 0 && (
            <div className="pay-more">
              {buttons.map((m) => (
                <button key={m.id} onClick={() => pick(m.id)}>
                  {m.name[lang]}
                </button>
              ))}
            </div>
          )}

          <label className="pay-switch">
            <span>{t('printReceiptSwitch')}</span>
            <i />
            <input type="checkbox" role="switch" className="switch" checked={printIt} onChange={(e) => setPrintIt(e.target.checked)} />
          </label>

          <div className="pay-foot">
            <button className="btn close" disabled={!valid || busy} onClick={() => void submit()}>
              {t('closeShort')}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
