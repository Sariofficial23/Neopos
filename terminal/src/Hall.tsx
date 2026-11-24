import takeawaySticker from './assets/takeaway.webp?inline'
import deliverySticker from './assets/delivery.webp?inline'
import { useCallback, useEffect, useState } from 'react'
import { api, money, type OpenReceipt, type Receipt } from './api'
import { useApp } from './app'
import { Dialog } from './Dialogs'
import { ReceiptsScreen } from './Receipts'

const stickers: Partial<Record<string, string>> = { takeaway: takeawaySticker, delivery: deliverySticker }

/**
 * Зал, как в Clopos: в верхней панели — вкладки залов, «Новый заказ», «Чеки» и меню;
 * столы — плоские плитки: серые свободные, фиолетовые занятые (официант и сумма).
 */
export function Hall({ onOpen, onMenu, hallId, setHallId }: { hallId: string; setHallId: (id: string) => void; onOpen: (r: Receipt) => void; onMenu: () => void }) {
  const { boot, t, lang, fail } = useApp()
  const [open, setOpen] = useState<OpenReceipt[]>([])
  const [busyTables, setBusyTables] = useState<string[]>([])
  const [dialog, setDialog] = useState<'type' | 'receipts' | null>(null)
  const [guestsFor, setGuestsFor] = useState<{ id: string; name: string } | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ receipts: OpenReceipt[]; busyTables: string[] }>('/pos/receipts')
      setOpen(r.receipts)
      setBusyTables(r.busyTables)
    } catch {
      /* временный обрыв связи: попробуем при следующем опросе */
    }
  }, [])

  // Опрашиваем открытые чеки, чтобы видеть заказы с других касс.
  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(id)
  }, [refresh])

  const hall = boot.halls.find((h) => h.id === hallId) ?? boot.halls[0]
  const byTable = new Map(open.filter((r) => r.tableId).map((r) => [r.tableId!, r]))
  const awaySales = boot.saleTypes.filter((s) => s.kind !== 'hall')

  async function start(body: { tableId?: string; saleTypeId?: string; guests?: number }) {
    if (pending) return
    setPending(true)
    try {
      onOpen(await api<Receipt>('/pos/receipts', { method: 'POST', body }))
    } catch (err) {
      fail(err)
      void refresh()
    } finally {
      setPending(false)
    }
  }

  const newOrder = () => {
    if (awaySales.length > 1) setDialog('type')
    else void start(awaySales[0] ? { saleTypeId: awaySales[0].id } : {})
  }

  // «Чеки» — отдельный экран на всё окно: открытые и закрытые.
  if (dialog === 'receipts') return <ReceiptsScreen open={open} onOpen={onOpen} onBack={() => setDialog(null)} />

  return (
    <>
      <header className="bar">
        <nav className="tabs bar-tabs" aria-label={t('hallsTitle')}>
          {boot.halls.map((h) => (
            <button key={h.id} className={h.id === hall?.id ? 'on' : ''} aria-pressed={h.id === hall?.id} onClick={() => setHallId(h.id)}>
              {h.name}
            </button>
          ))}
        </nav>
        <button className="new" onClick={newOrder}>
          + {t('newOrder')}
        </button>
        <button className="bar-btn" onClick={() => setDialog('receipts')}>
          {t('receiptsTitle')}
          {open.length > 0 && <span className="n num">{open.length}</span>}
        </button>
        <button className="ico" onClick={onMenu} title={t('controlPanel')} aria-label={t('controlPanel')}>
          <svg viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      <div className="hall">
        {!hall || hall.tables.length === 0 ? (
          <div className="empty-note">{t('noTables')}</div>
        ) : (
          <div className="tgrid">
            {hall.tables.map((tb) => {
              const r = byTable.get(tb.id)
              // Стол занят чужим чеком, которого этот сотрудник не видит.
              const foreign = !r && busyTables.includes(tb.id)
              return (
                <button
                  key={tb.id}
                  className={`table ${r ? (r.billPrinted ? 'busy bill' : 'busy') : foreign ? 'other' : ''}`}
                  // Свободный стол сначала спрашивает число гостей, занятый открывается сразу.
                  onClick={() => (r || foreign ? void start({ tableId: tb.id }) : setGuestsFor({ id: tb.id, name: tb.name }))}
                >
                  <b>
                    {t('table')} {tb.name}
                  </b>
                  {r && (
                    <>
                      <span className="waiter">({r.waiterName || '—'})</span>
                      <small className="num">
                        {money(r.total)} {t('sum')}
                      </small>
                      {r.billPrinted && <span className="bill-tag">✓ {t('billPrintedTag')}</span>}
                    </>
                  )}
                  {foreign && <small>{t('occupied')}</small>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {guestsFor && (
        <GuestsDialog
          title={`${t('guestsPick')} · ${t('table')} ${guestsFor.name}`}
          onClose={() => setGuestsFor(null)}
          onSave={(guests) => {
            const tableId = guestsFor.id
            setGuestsFor(null)
            void start({ tableId, guests })
          }}
        />
      )}

      {dialog === 'type' && (
        <Dialog title={t('saleType')} onClose={() => setDialog(null)}>
          <div className="stickers">
            {awaySales.map((s) => (
              <button key={s.id} className="sticker" disabled={pending} onClick={() => void start({ saleTypeId: s.id })}>
                <span className="emoji" aria-hidden="true">
                  {stickers[s.kind] ? <img src={stickers[s.kind]} alt="" decoding="async" /> : '🧾'}
                </span>
                <span>{s.name[lang]}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}

/** «Выбор кол-ва гостей»: цифровая клавиатура и зелёная кнопка «Сохранить», как в Clopos. */
function GuestsDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (guests: number) => void }) {
  const { t } = useApp()
  const [value, setValue] = useState('')
  const guests = Math.min(99, Math.max(1, Number(value) || 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setValue((v) => (v + e.key).slice(0, 2))
      else if (e.key === 'Backspace') setValue((v) => v.slice(0, -1))
      else if (e.key === 'Enter') onSave(guests)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guests, onSave])

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="gp-value num" aria-live="polite">
        {value || '1'}
      </div>
      <div className="gpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => setValue((v) => (v + d).slice(0, 2))}>
            {d}
          </button>
        ))}
        <span />
        <button onClick={() => setValue((v) => (v + '0').slice(0, 2))}>0</button>
        <button aria-label="Backspace" onClick={() => setValue((v) => v.slice(0, -1))}>
          ⌫
        </button>
      </div>
      <button className="btn close wide" onClick={() => onSave(guests)}>
        ✓ {t('save')}
      </button>
    </Dialog>
  )
}
