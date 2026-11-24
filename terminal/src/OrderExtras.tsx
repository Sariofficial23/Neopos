import { useEffect, useState } from 'react'
import { api, money, qtyText, type Receipt, type ReceiptItem } from './api'
import { useApp } from './app'
import { Dialog } from './Dialogs'

const digits = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 10)

/**
 * Окно позиции чека, как в Clopos: количество (пока не отправлено на кухню),
 * изменение цены, угощение и удаление отправленной позиции с причиной.
 * Каждое действие видно только тем, у кого есть на него право.
 */
export function LineDialog({
  item,
  onClose,
  onQty,
  onPrice,
  onComp,
  onVoid,
}: {
  item: ReceiptItem
  onClose: () => void
  onQty: (qty: number) => void
  onPrice: (price: number) => void
  onComp: (comp: boolean) => void
  onVoid: (reasonId: string) => void
}) {
  const { t, lang, boot, can } = useApp()
  const [n, setN] = useState(Math.round(item.qty / 1000))
  const [price, setPrice] = useState(String(item.price))
  const [voiding, setVoiding] = useState(false)
  const reasons = boot.reasons.filter((r) => r.kind === 'void')

  if (voiding)
    return (
      <Dialog title={t('voidTitle')} onClose={() => setVoiding(false)}>
        <div className="muted" style={{ marginTop: -8 }}>
          {qtyText(item.qty)} × {item.name[lang]}
        </div>
        <div className="list">
          {reasons.map((r) => (
            <button key={r.id} onClick={() => onVoid(r.id)}>
              {r.name[lang]}
            </button>
          ))}
        </div>
      </Dialog>
    )

  return (
    <Dialog title={item.name[lang]} onClose={onClose}>
      <div className="muted num" style={{ marginTop: -8 }}>
        {qtyText(item.qty)} × {money(item.price)} = {money(item.total)}
      </div>

      {!item.sent && (
        <>
          <div className="stepper">
            <button aria-label="−" onClick={() => setN((v) => Math.max(0, v - 1))}>
              −
            </button>
            <b className="num">{n}</b>
            <button aria-label="+" onClick={() => setN((v) => Math.min(999, v + 1))}>
              +
            </button>
          </div>
          <div className="row">
            <button className="btn plain" style={{ color: 'var(--danger)' }} onClick={() => onQty(0)}>
              {t('remove')}
            </button>
            <button className="btn send" onClick={() => onQty(n * 1000)}>
              {t('done')}
            </button>
          </div>
        </>
      )}

      {can('receipt.change_price') && (
        <form
          className="line-price"
          onSubmit={(e) => {
            e.preventDefault()
            if (price !== '') onPrice(Number(price))
          }}
        >
          <label className="field">
            <span>
              {t('changePrice')}, {t('sum')}
            </span>
            <input className="input num" inputMode="numeric" value={price} onChange={(e) => setPrice(digits(e.target.value))} />
          </label>
          <button className="btn send" disabled={price === '' || Number(price) === item.price}>
            {t('save')}
          </button>
        </form>
      )}

      {can('receipt.comp') && (
        <label className="switch-row">
          <span>🎁 {t('compItem')}</span>
          <input type="checkbox" role="switch" className="switch" checked={!!item.comp} onChange={(e) => onComp(e.target.checked)} />
        </label>
      )}

      {item.sent && can('receipt.void_sent_item') && (
        <button className="btn plain wide danger-text" onClick={() => setVoiding(true)}>
          {t('voidTitle')}
        </button>
      )}
    </Dialog>
  )
}

/** «Перенос стола»: выбрать свободный стол в любом зале. */
export function MoveDialog({ receipt, onClose, onMove }: { receipt: Receipt; onClose: () => void; onMove: (tableId: string) => void }) {
  const { t, boot, fail } = useApp()
  const [hallId, setHallId] = useState(() => boot.halls.find((h) => h.tables.some((tb) => tb.id === receipt.tableId))?.id ?? boot.halls[0]?.id ?? '')
  const [busy, setBusy] = useState<string[] | null>(null)

  useEffect(() => {
    api<{ busyTables: string[] }>('/pos/receipts')
      .then((r) => setBusy(r.busyTables))
      .catch(fail)
  }, [fail])

  const hall = boot.halls.find((h) => h.id === hallId) ?? boot.halls[0]

  return (
    <Dialog title={t('moveTable')} onClose={onClose}>
      {boot.halls.length > 1 && (
        <div className="tabs move-tabs">
          {boot.halls.map((h) => (
            <button key={h.id} className={h.id === hall?.id ? 'on' : ''} onClick={() => setHallId(h.id)}>
              {h.name}
            </button>
          ))}
        </div>
      )}
      {!busy ? (
        <div className="muted">{t('loading')}</div>
      ) : (
        <div className="move-grid">
          {hall?.tables.map((tb) => {
            const current = tb.id === receipt.tableId
            const taken = busy.includes(tb.id)
            return (
              <button key={tb.id} disabled={taken} className={current ? 'current' : taken ? 'taken' : ''} onClick={() => onMove(tb.id)}>
                {t('table')} {tb.name}
              </button>
            )
          })}
        </div>
      )}
      <div className="muted" style={{ fontSize: 13 }}>
        {t('moveHint')}
      </div>
    </Dialog>
  )
}
