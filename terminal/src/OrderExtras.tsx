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
  onDiscount,
  onVoid,
}: {
  item: ReceiptItem
  onClose: () => void
  onQty: (qty: number) => void
  onPrice: (price: number) => void
  onComp: (comp: boolean) => void
  onDiscount: (d: { kind: 'percent' | 'amount'; value: number } | { kind: 'none' }) => void
  onVoid: (reasonId: string) => void
}) {
  const { t, lang, boot, can } = useApp()
  const [n, setN] = useState(Math.round(item.qty / 1000))
  const [price, setPrice] = useState(String(item.price))
  const [voiding, setVoiding] = useState(false)
  const [disc, setDisc] = useState('')
  const gross = Math.round((item.price * item.qty) / 1000)
  const hasDiscount = (item.discountAmount ?? 0) > 0
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
        {qtyText(item.qty)} × {money(item.price)} = {hasDiscount ? `${money(gross)} − ${money(item.discountAmount ?? 0)} = ` : ''}
        {money(item.total)}
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

      {can('receipt.discount') && !item.comp && (
        <div className="line-disc">
          <span className="field-label">
            {t('itemDiscount')}
            {hasDiscount && (
              <b className="num">
                {' '}
                · {item.discountPercent ? `${item.discountPercent}%` : `${money(item.discountAmount ?? 0)} ${t('sum')}`}
              </b>
            )}
          </span>
          <div className="line-disc-quick">
            {[5, 10, 15, 20, 50].map((p) => (
              <button key={p} type="button" className={item.discountPercent === p ? 'on' : ''} onClick={() => onDiscount({ kind: 'percent', value: p })}>
                {p}%
              </button>
            ))}
          </div>
          <div className="line-disc-own">
            <input className="input num" inputMode="numeric" placeholder="0" aria-label={t('itemDiscount')} value={disc} onChange={(e) => setDisc(digits(e.target.value))} />
            <button type="button" className="btn plain" disabled={!Number(disc) || Number(disc) > 100} onClick={() => onDiscount({ kind: 'percent', value: Number(disc) })}>
              %
            </button>
            <button type="button" className="btn plain" disabled={!Number(disc) || Number(disc) > gross} onClick={() => onDiscount({ kind: 'amount', value: Number(disc) })}>
              {t('sum')}
            </button>
            {hasDiscount && (
              <button type="button" className="btn plain danger-text" onClick={() => onDiscount({ kind: 'none' })}>
                {t('itemDiscountOff')}
              </button>
            )}
          </div>
        </div>
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

/**
 * «Разделить счёт», как в Clopos: отметить, сколько каждой позиции уходит в новый чек за тем же столом.
 * Штучные позиции делятся по одной, весовые переносятся целиком. Хотя бы одна позиция должна остаться.
 */
export function SplitDialog({ receipt, onClose, onSplit }: { receipt: Receipt; onClose: () => void; onSplit: (items: { itemId: string; qty: number }[]) => void }) {
  const { t, lang } = useApp()
  const live = receipt.items.filter((i) => !i.voided)
  const [take, setTake] = useState<Record<string, number>>({})
  const whole = (i: ReceiptItem) => i.qty % 1000 === 0
  const set = (i: ReceiptItem, qty: number) => setTake((cur) => ({ ...cur, [i.id]: Math.max(0, Math.min(i.qty, qty)) }))
  const picked = live.filter((i) => (take[i.id] ?? 0) > 0)
  const sum = picked.reduce((a, i) => a + (i.comp ? 0 : Math.round((i.total * take[i.id]) / i.qty)), 0)
  const all = live.length > 0 && live.every((i) => take[i.id] === i.qty)

  return (
    <Dialog title={t('splitTitle')} onClose={onClose}>
      <div className="muted" style={{ marginTop: -8, fontSize: 13 }}>
        {t('splitHint')}
      </div>
      <div className="split-list">
        {live.map((i) => {
          const n = take[i.id] ?? 0
          return (
            <div key={i.id} className={`split-row ${n ? 'on' : ''}`}>
              <span className="split-name">
                {i.name[lang]}
                <small className="num">
                  {qtyText(i.qty)} × {money(i.price)}
                </small>
              </span>
              {whole(i) && i.qty > 1000 ? (
                <span className="split-step">
                  <button aria-label="−" onClick={() => set(i, n - 1000)} disabled={!n}>
                    −
                  </button>
                  <b className="num">{n / 1000}</b>
                  <button aria-label="+" onClick={() => set(i, n + 1000)} disabled={n >= i.qty}>
                    +
                  </button>
                </span>
              ) : (
                <input type="checkbox" role="switch" className="switch" aria-label={i.name[lang]} checked={n > 0} onChange={(e) => set(i, e.target.checked ? i.qty : 0)} />
              )}
            </div>
          )
        })}
      </div>
      <div className="err" role="alert">
        {all ? t('splitAll') : ''}
      </div>
      <button className="btn send wide" disabled={!picked.length || all} onClick={() => onSplit(picked.map((i) => ({ itemId: i.id, qty: take[i.id] })))}>
        {t('splitDo')}
        {picked.length > 0 && !all ? ` · ${money(sum)} ${t('sum')}` : ''}
      </button>
    </Dialog>
  )
}

/** «Объединить чеки», как в Clopos: выбрать другой открытый чек — его позиции перейдут в этот. */
export function MergeDialog({ receipt, onClose, onMerge }: { receipt: Receipt; onClose: () => void; onMerge: (fromId: string) => void }) {
  const { t, boot, lang, fail } = useApp()
  const [list, setList] = useState<{ id: string; number: number; tableName: string | null; saleTypeId: string | null; waiterName: string | null; total: number }[] | null>(null)

  useEffect(() => {
    api<{ receipts: NonNullable<typeof list> }>('/pos/receipts')
      .then((r) => setList(r.receipts.filter((x) => x.id !== receipt.id)))
      .catch(fail)
  }, [fail, receipt.id])

  const place = (x: NonNullable<typeof list>[number]) => (x.tableName ? `${t('table')} ${x.tableName}` : (boot.saleTypes.find((s) => s.id === x.saleTypeId)?.name[lang] ?? '—'))

  return (
    <Dialog title={t('mergeTitle')} onClose={onClose}>
      <div className="muted" style={{ marginTop: -8, fontSize: 13 }}>
        {t('mergeHint')}
      </div>
      {!list ? (
        <div className="muted">{t('loading')}</div>
      ) : list.length === 0 ? (
        <div className="muted">{t('mergeNone')}</div>
      ) : (
        <div className="list">
          {list.map((x) => (
            <button key={x.id} className="btn plain wide" style={{ justifyContent: 'space-between' }} onClick={() => window.confirm(`${t('mergeConfirm')} №${x.number}?`) && onMerge(x.id)}>
              <span>
                №{x.number} · {place(x)} · {x.waiterName || '—'}
              </span>
              <b className="num">
                {money(x.total)} {t('sum')}
              </b>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

/** «Изменить владельца чека»: перевести чек на другого сотрудника. */
export function WaiterDialog({ receipt, onClose, onPick }: { receipt: Receipt; onClose: () => void; onPick: (waiterId: string) => void }) {
  const { t, fail } = useApp()
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null)
  useEffect(() => {
    api<{ id: string; name: string }[]>('/pos/waiters').then(setList).catch(fail)
  }, [fail])
  return (
    <Dialog title={t('waiterTitle')} onClose={onClose}>
      {!list ? (
        <div className="muted">{t('loading')}</div>
      ) : (
        <div className="list">
          {list.map((u) => (
            <button key={u.id} className={`btn wide ${u.id === receipt.waiterId ? 'send' : 'plain'}`} onClick={() => onPick(u.id)}>
              {u.name}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

/** «Изменить способ продажи»: в зале, с собой, доставка. */
export function SaleTypeDialog({ receipt, onClose, onPick }: { receipt: Receipt; onClose: () => void; onPick: (saleTypeId: string) => void }) {
  const { t, boot, lang } = useApp()
  return (
    <Dialog title={t('saleTypeTitle')} onClose={onClose}>
      <div className="list">
        {boot.saleTypes.map((s) => (
          <button key={s.id} className={`btn wide ${s.id === receipt.saleTypeId ? 'send' : 'plain'}`} onClick={() => onPick(s.id)}>
            {s.name[lang]}
          </button>
        ))}
      </div>
      {receipt.tableId && (
        <div className="muted" style={{ fontSize: 13 }}>
          {t('saleTypeHint')}
        </div>
      )}
    </Dialog>
  )
}
