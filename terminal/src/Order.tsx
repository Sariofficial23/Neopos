import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, money, qtyText, type Receipt, type ReceiptItem } from './api'
import { useApp } from './app'
import { Dialog, PayDialog } from './Dialogs'
import { CategoryForm, loadMenu, ProductForm, type FullCategory, type FullProduct } from './MenuEdit'
import { guestReceipt, kitchenSlips, printSlips } from './print'

type Props = { receipt: Receipt; setReceipt: (r: Receipt) => void; onBack: () => void }

const Icon = {
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  discount: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>
  ),
  comment: <path d="M4 5h16v11H9l-5 4z" />,
  guests: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c2 .7 3.5 2.3 3.5 5.2" />
    </>
  ),
  print: (
    <>
      <path d="M7 8V3h10v5M7 17H4v-7h16v7h-3" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  home: <path d="M3 11 12 3l9 8M5 10v10h14V10" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
}
const Svg = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24">{children}</svg>

export function Order({ receipt, setReceipt, onBack }: Props) {
  const { boot, t, lang, can, toast, fail, reloadBoot } = useApp()
  const [cat, setCat] = useState<string | null>(null)
  // Настройка меню прямо на кассе: ⚙ рядом с «домиком», «+» добавляет, нажатие на плитку — изменить.
  const [menu, setMenu] = useState<Awaited<ReturnType<typeof loadMenu>> | null>(null)
  const [editing, setEditing] = useState<{ kind: 'category'; item: FullCategory | null } | { kind: 'product'; item: FullProduct | null } | null>(null)
  const editMode = menu !== null

  async function toggleEdit() {
    if (editMode) return setMenu(null)
    try {
      setQuery(null)
      setMenu(await loadMenu())
    } catch (err) {
      fail(err)
    }
  }

  async function menuSaved() {
    const [next] = await Promise.all([loadMenu(), reloadBoot()])
    setMenu(next)
  }

  const fullCategory = (id: string) => menu?.categories.find((c) => c.id === id) ?? null
  const fullProduct = (id: string) => menu?.products.find((p) => p.id === id) ?? null
  const [query, setQuery] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'pay' | 'discount' | 'comment' | 'guests' | null>(null)
  const [line, setLine] = useState<ReceiptItem | null>(null)
  const [busy, setBusy] = useState(false)
  const linesRef = useRef<HTMLUListElement>(null)
  // Запросы к чеку идут строго по очереди: быстрые нажатия на плитки не должны обгонять друг друга.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const base = `/pos/receipts/${receipt.id}`
  const fresh = receipt.items.filter((i) => !i.sent && !i.voided)
  const freshCount = fresh.reduce((s, i) => s + Math.ceil(i.qty / 1000), 0)
  const hasLive = receipt.items.some((i) => !i.voided)

  useEffect(() => {
    const el = linesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [receipt.items.length])

  /** Ставит действие в очередь; ошибку показывает всплывающей строкой. */
  function enqueue(action: () => Promise<void>) {
    queue.current = queue.current.then(async () => {
      try {
        await action()
      } catch (err) {
        fail(err)
      }
    })
    return queue.current
  }

  /** Запрос к чеку: подставляет вернувшийся чек и передаёт его дальше. */
  function call(path: string, method: string, body?: unknown, after?: (r: Receipt) => void) {
    return enqueue(async () => {
      const res = await api<Receipt | { receipt: Receipt }>(base + path, { method, body })
      const next = 'receipt' in res ? res.receipt : res
      setReceipt(next)
      after?.(next)
    })
  }

  /** Бегунки на кухню для указанных позиций — если печать на кухню включена в настройках. */
  const kitchen = (r: Receipt, ids: Set<string>, cancelled = false) =>
    boot.print.kitchen ? kitchenSlips(r, r.items.filter((i) => ids.has(i.id)), boot, lang, cancelled) : []

  /** Печать без ожидания: заказ уже сохранён, а о сбое принтера сообщаем строкой внизу. */
  const printOut = (slips: string[]) =>
    void printSlips(slips).then((err) => {
      if (err) toast(`${t('printFailed')}: ${err}`)
    })

  const add = (productId: string) => void call('/items', 'POST', { productId })

  async function back() {
    await queue.current
    // Пустой чек не оставляем висеть на столе.
    if (!receipt.items.length) {
      try {
        await api(base, { method: 'DELETE' })
      } catch {
        /* чек могли уже закрыть с другой кассы */
      }
    }
    onBack()
  }

  async function send() {
    setBusy(true)
    await enqueue(async () => {
      const res = await api<{ receipt: Receipt; sent: { id: string }[] }>(`${base}/send`, { method: 'POST' })
      setReceipt(res.receipt)
      printOut(kitchen(res.receipt, new Set(res.sent.map((s) => s.id))))
    })
    setBusy(false)
  }

  /** Счёт гостю: неотправленное уходит на кухню, стол в зале помечается «счёт выдан». */
  async function bill() {
    setBusy(true)
    await enqueue(async () => {
      const res = await api<{ receipt: Receipt; sentIds: string[] }>(`${base}/bill`, { method: 'POST' })
      setReceipt(res.receipt)
      printOut([...kitchen(res.receipt, new Set(res.sentIds)), guestReceipt(res.receipt, boot, lang, { final: false })])
    })
    setBusy(false)
  }

  const tapLine = (i: ReceiptItem) => {
    if (i.voided) return
    if (i.sent && !can('receipt.void_sent_item')) return toast(t('err.no_permission'))
    setLine(i)
  }

  const products = useMemo(() => {
    if (query !== null) {
      const q = query.trim().toLowerCase()
      if (!q && editMode) return []
      if (q) return boot.products.filter((p) => p.name.uz.toLowerCase().includes(q) || p.name.ru.toLowerCase().includes(q))
    }
    if (!editMode && cat === null) {
      const favorites = boot.products.filter((p) => p.favorite && !p.stopped)
      return favorites.length ? favorites : boot.products
    }
    return boot.products.filter((p) => p.categoryId === cat)
  }, [boot.products, cat, query, editMode])

  const current = boot.categories.find((c) => c.id === cat)
  const title = receipt.tableName ? `${t('table')} ${receipt.tableName}` : (boot.saleTypes.find((s) => s.id === receipt.saleTypeId)?.name[lang] ?? t('noTable'))

  return (
    <>
      <header className="bar order-bar">
        <div className="logo"><img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" /></div>
        <span className="lnk hide">{boot.user.name}</span>
      </header>

      <div className="work order-work">
        <section className="check glass" aria-label={title}>
          <nav className="rail">
            <button title={t('back')} aria-label={t('back')} onClick={() => void back()}>
              <Svg>{Icon.back}</Svg>
            </button>
            {can('receipt.discount') && (
              <button
                title={t('discount')}
                aria-label={t('discount')}
                className={receipt.discountKind ? 'on' : ''}
                onClick={() => setDialog('discount')}
              >
                <Svg>{Icon.discount}</Svg>
              </button>
            )}
            <button
              title={t('comment')}
              aria-label={t('comment')}
              className={receipt.comment ? 'on' : ''}
              onClick={() => setDialog('comment')}
            >
              <Svg>{Icon.comment}</Svg>
            </button>
            <button title={t('guests')} aria-label={t('guests')} onClick={() => setDialog('guests')}>
              <Svg>{Icon.guests}</Svg>
            </button>
            <button
              title={t('printBill')}
              aria-label={t('printBill')}
              className={`rail-print ${receipt.billPrinted ? 'on' : ''}`}
              disabled={!hasLive || busy}
              onClick={() => void bill()}
            >
              <Svg>{Icon.print}</Svg>
            </button>
          </nav>

          <div className="head">
            <b>{title}</b>
            <span className="num">
              <span className="t">{receipt.guests} 👤 · </span>№{receipt.number}
            </span>
          </div>

          <ul className="lines" ref={linesRef}>
            {receipt.items.length === 0 && <li className="none">{t('emptyCheck')}</li>}
            {receipt.items.map((i) => (
              <li key={i.id} className={i.voided ? 'void' : i.sent ? '' : 'new'}>
                <button onClick={() => tapLine(i)}>
                  <span className="q num">{qtyText(i.qty)}</span>
                  <span className="nm">
                    {i.name[lang]}
                    {i.comment && <small>{i.comment}</small>}
                  </span>
                  <span className="s num">{money(i.total)}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="sum num">
            {(receipt.discountAmount > 0 || receipt.serviceAmount > 0) && <div>{money(receipt.subtotal)}</div>}
            {receipt.discountAmount > 0 && (
              <div className="disc">
                {t('discount').toLowerCase()}
                {receipt.discountKind === 'percent' ? ` ${receipt.discountValue}%` : ''}: −{money(receipt.discountAmount)}
              </div>
            )}
            {receipt.serviceAmount > 0 && (
              <div>
                {t('service')} {receipt.serviceBp / 100}%: {money(receipt.serviceAmount)}
              </div>
            )}
            <div className="tot">
              {money(receipt.total)} {t('sum')}
            </div>
          </div>

          <div className="foot">
            <button className="btn send" disabled={freshCount === 0 || busy} onClick={() => void send()}>
              {t('send')} {freshCount > 0 && <i className="num">{freshCount}</i>}
            </button>
            <button className="btn close" disabled={!hasLive} onClick={() => setDialog('pay')}>
              {t('closeCheck')}
            </button>
          </div>
        </section>

        <section className="menu">
          <div className="crumbs">
            <button
              className="glass"
              title={t('allCategories')}
              aria-label={t('allCategories')}
              onClick={() => {
                setCat(null)
                setQuery(null)
              }}
            >
              <Svg>{Icon.home}</Svg>
            </button>
            {can('menu.edit') && (
              <button
                className={`glass ${editMode ? 'on' : ''}`}
                title={t('menuSettings')}
                aria-label={t('menuSettings')}
                aria-pressed={editMode}
                onClick={() => void toggleEdit()}
              >
                <Svg>{Icon.gear}</Svg>
              </button>
            )}
            {(!editMode || query !== null) ? (
              <input
                className="glass"
                autoFocus={editMode}
                type="search"
                placeholder={t('search')}
                aria-label={t('search')}
                value={query ?? ''}
                onChange={(e) => setQuery(e.target.value)}
              />
            ) : (
              <>
                {current && <span className="glass">{current.name[lang]}</span>}
                <button className="glass sp" title={t('search')} aria-label={t('search')} onClick={() => setQuery('')}>
                  <Svg>{Icon.search}</Svg>
                </button>
              </>
            )}
          </div>

          {!editMode && (
            <nav className="tabs order-tabs" aria-label={t('allCategories')}>
              <button aria-pressed={cat === null} className={cat === null ? 'on' : ''} onClick={() => { setCat(null); setQuery(null) }}>
                {t('quickMenu')}
              </button>
              {boot.categories.map((c) => (
                <button key={c.id} aria-pressed={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => { setCat(c.id); setQuery(null) }}>
                  {c.name[lang]}
                </button>
              ))}
            </nav>
          )}
          {editMode && <div className="edit-hint">⚙ {t('menuEditOn')}</div>}

          <div className="tiles">
            {editMode && query === null &&
              cat === null &&
              boot.categories.map((c) => (
                <button key={c.id} className={`tile ${editMode ? 'editing' : ''}`} style={{ ['--c' as string]: c.color ?? '#64748b' }} onClick={() => setCat(c.id)}>
                  {editMode && (
                    <span
                      className="pen"
                      role="button"
                      aria-label={t('editCategory')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ kind: 'category', item: fullCategory(c.id) })
                      }}
                    >
                      ✎
                    </span>
                  )}
                  {c.name[lang]}
                </button>
              ))}
            {products.map((p) => (
              <button
                key={p.id}
                className={`tile ${editMode ? 'editing' : ''}`}
                disabled={p.stopped && !editMode}
                onClick={() => (editMode ? setEditing({ kind: 'product', item: fullProduct(p.id) }) : add(p.id))}
              >
                <span className="p num">{money(p.price)} {t('sum')}</span>
                <span>{p.name[lang]}</span>
                {p.favorite && <span className="star">★</span>}
                {p.stopped && <span className="stop">{t('stop')}</span>}
              </button>
            ))}
            {editMode && query === null && (
              <button
                className="tile add"
                title={cat ? t('newProduct') : t('newCategory')}
                aria-label={cat ? t('newProduct') : t('newCategory')}
                onClick={() => setEditing(cat ? { kind: 'product', item: null } : { kind: 'category', item: null })}
              >
                +
              </button>
            )}
            {query !== null && query.trim() !== '' && products.length === 0 && <div className="muted">{t('nothingFound')}</div>}
          </div>
        </section>
      </div>

      {editing?.kind === 'category' && (
        <CategoryForm category={editing.item} sort={boot.categories.length} onClose={() => setEditing(null)} onSaved={menuSaved} />
      )}
      {editing?.kind === 'product' && menu && (
        <ProductForm
          product={editing.item}
          categoryId={cat}
          categories={menu.categories}
          sort={products.length}
          onClose={() => setEditing(null)}
          onSaved={menuSaved}
        />
      )}

      {line && !line.sent && (
        <QtyDialog
          item={line}
          onClose={() => setLine(null)}
          onSave={(qty) => void call(`/items/${line.id}`, 'PATCH', { qty }, () => setLine(null))}
        />
      )}

      {line && line.sent && (
        <Dialog title={t('voidTitle')} onClose={() => setLine(null)}>
          <div className="muted" style={{ marginTop: -8 }}>
            {qtyText(line.qty)} × {line.name[lang]}
          </div>
          <div className="list">
            {boot.reasons
              .filter((r) => r.kind === 'void')
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() =>
                    void call(`/items/${line.id}/void`, 'POST', { reasonId: r.id }, (next) => {
                      setLine(null)
                      // Кухня должна узнать, что блюдо готовить не нужно.
                      printOut(kitchen(next, new Set([line.id]), true))
                    })
                  }
                >
                  {r.name[lang]}
                </button>
              ))}
          </div>
        </Dialog>
      )}

      {dialog === 'discount' && (
        <DiscountDialog
          receipt={receipt}
          onClose={() => setDialog(null)}
          onSave={(body) => void call('/discount', 'POST', body, () => setDialog(null))}
        />
      )}

      {dialog === 'comment' && (
        <TextDialog
          title={t('comment')}
          hint={t('commentHint')}
          initial={receipt.comment ?? ''}
          onClose={() => setDialog(null)}
          onSave={(v) => void call('', 'PATCH', { comment: v || null }, () => setDialog(null))}
        />
      )}

      {dialog === 'guests' && (
        <QtyDialog
          title={t('guests')}
          item={{ qty: receipt.guests * 1000 }}
          min={1}
          onClose={() => setDialog(null)}
          onSave={(qty) => void call('', 'PATCH', { guests: qty / 1000 }, () => setDialog(null))}
        />
      )}

      {dialog === 'pay' && (
        <PayDialog
          receipt={receipt}
          onClose={() => setDialog(null)}
          onPaid={(change, closed, printReceipt) => {
            toast(change > 0 ? `${t('paid')} · ${t('change')}: ${money(change)}` : t('paid'))
            // Оплата сама отправляет на кухню то, что не успели отправить, — печатаем и это.
            const late = new Set(fresh.map((i) => i.id))
            printOut([
              ...kitchen(closed, late),
              ...(printReceipt ? [guestReceipt(closed, boot, lang, { final: true, change })] : []),
            ])
            onBack()
          }}
        />
      )}
    </>
  )
}

/** Количество: большие «−» и «+». Для позиции чека 0 означает «убрать». */
function QtyDialog({
  item,
  title,
  min = 0,
  onClose,
  onSave,
}: {
  item: { qty: number; name?: ReceiptItem['name'] }
  title?: string
  min?: number
  onClose: () => void
  onSave: (qty: number) => void
}) {
  const { t, lang } = useApp()
  const [n, setN] = useState(Math.round(item.qty / 1000))
  return (
    <Dialog title={title ?? item.name?.[lang] ?? t('qty')} onClose={onClose}>
      <div className="stepper">
        <button aria-label="−" onClick={() => setN((v) => Math.max(min, v - 1))}>
          −
        </button>
        <b className="num">{n}</b>
        <button aria-label="+" onClick={() => setN((v) => Math.min(999, v + 1))}>
          +
        </button>
      </div>
      <div className="row">
        {min === 0 && (
          <button className="btn plain" style={{ color: 'var(--danger)' }} onClick={() => onSave(0)}>
            {t('remove')}
          </button>
        )}
        <button className="btn send" onClick={() => onSave(n * 1000)}>
          {t('done')}
        </button>
      </div>
    </Dialog>
  )
}

type DiscountBody = { kind: 'percent' | 'amount'; value: number } | { kind: 'none' }

function DiscountDialog({ receipt, onClose, onSave }: { receipt: Receipt; onClose: () => void; onSave: (b: DiscountBody) => void }) {
  const { t } = useApp()
  const [kind, setKind] = useState<'percent' | 'amount'>(receipt.discountKind ?? 'percent')
  const [value, setValue] = useState(receipt.discountKind ? String(receipt.discountValue) : '')
  const num = Number(value) || 0
  const valid = kind === 'percent' ? num >= 1 && num <= 100 : num >= 1

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) onSave({ kind, value: num })
  }

  return (
    <Dialog title={t('discount')} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <div className="seg">
          <button type="button" className={kind === 'percent' ? 'on' : ''} onClick={() => setKind('percent')}>
            {t('percent')} %
          </button>
          <button type="button" className={kind === 'amount' ? 'on' : ''} onClick={() => setKind('amount')}>
            {t('amount')}
          </button>
        </div>
        {kind === 'percent' && (
          <div className="quick">
            {[5, 10, 15, 20].map((p) => (
              <button type="button" key={p} onClick={() => setValue(String(p))}>
                {p}%
              </button>
            ))}
          </div>
        )}
        <input
          className="input num"
          inputMode="numeric"
          autoFocus
          aria-label={t('discount')}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, kind === 'percent' ? 3 : 12))}
        />
        <div className="row">
          {receipt.discountKind && (
            <button type="button" className="btn plain" onClick={() => onSave({ kind: 'none' })}>
              {t('removeDiscount')}
            </button>
          )}
          <button className="btn send" disabled={!valid}>
            {t('save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function TextDialog({
  title,
  hint,
  initial,
  onClose,
  onSave,
}: {
  title: string
  hint: string
  initial: string
  onClose: () => void
  onSave: (v: string) => void
}) {
  const { t } = useApp()
  const [value, setValue] = useState(initial)
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(value.trim())
        }}
        style={{ display: 'grid', gap: 14 }}
      >
        <input className="input" autoFocus maxLength={300} placeholder={hint} aria-label={title} value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn send wide">{t('save')}</button>
      </form>
    </Dialog>
  )
}
