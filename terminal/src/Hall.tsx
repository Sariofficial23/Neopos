import takeawaySticker from './assets/takeaway.webp?inline'
import deliverySticker from './assets/delivery.webp?inline'
import { useCallback, useEffect, useState } from 'react'
import { api, money, type OpenReceipt, type Receipt } from './api'
import { useApp } from './app'
import { Dialog } from './Dialogs'

const stickers: Partial<Record<string, string>> = { takeaway: takeawaySticker, delivery: deliverySticker }

/** Сколько минут открыт чек */
const minutes = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))

export function Hall({ onOpen, onMenu, hallId, setHallId }: { hallId: string; setHallId: (id: string) => void; onOpen: (r: Receipt) => void; onMenu: () => void }) {
  const { boot, t, lang, fail } = useApp()
  const [open, setOpen] = useState<OpenReceipt[]>([])
  const [busyTables, setBusyTables] = useState<string[]>([])
  const [dialog, setDialog] = useState<'type' | null>(null)
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

  async function start(body: { tableId?: string; saleTypeId?: string }) {
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

  return (
    <>
      <header className="bar hall-bar" data-scene="samarkand">
        <div className="logo"><img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" /></div>
        <strong className="hall-title">{t('tablesTitle')}</strong>
        <nav className="tabs hall-tabs" aria-label={t('hallsTitle')}>
          {boot.halls.map((h) => (
            <button key={h.id} className={h.id === hall?.id ? 'on' : ''} aria-pressed={h.id === hall?.id} onClick={() => setHallId(h.id)}>{h.name}</button>
          ))}
        </nav>
        <button className="new" onClick={newOrder}>+ {t('newOrder')}</button>
        <button className="ico" onClick={onMenu} title={t('controlPanel')} aria-label={t('controlPanel')}>
          <svg viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      <div className="hall samarkand">
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
                  className={`table glass ${r ? (r.billPrinted ? 'busy bill' : 'busy') : foreign ? 'other' : ''}`}
                  onClick={() => void start({ tableId: tb.id })}
                >
                  <b>{tb.name}</b>
                  {r ? (
                    <>
                      <span className="occupation">{t('occupied')}</span>
                      <strong className="num">{money(r.total)} {t('sum')}</strong>
                      <span className="waiter">{t('servedBy')}: {r.waiterName || '—'}</span>
                      <small className="num">
                        {minutes(r.openedAt)} {t('min')}
                      </small>
                      {r.billPrinted && (
                        <span className="bill-tag" title={t('billPrintedTag')}>
                          ✓ {t('billPrintedTag')}
                        </span>
                      )}
                    </>
                  ) : (
                    <small>{foreign ? t('occupied') : t('free')}</small>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

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
