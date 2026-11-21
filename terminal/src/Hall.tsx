import takeawaySticker from './assets/takeaway.webp?inline'
import deliverySticker from './assets/delivery.webp?inline'
import { useCallback, useEffect, useState } from 'react'
import { api, money, type OpenReceipt, type Receipt } from './api'
import { useApp } from './app'
import { Dialog } from './Dialogs'

const stickers: Partial<Record<string, string>> = { takeaway: takeawaySticker, delivery: deliverySticker }

/** Сколько минут открыт чек */
const minutes = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))

export function Hall({ onOpen, onMenu }: { onOpen: (r: Receipt) => void; onMenu: () => void }) {
  const { boot, t, lang, fail, logout } = useApp()
  const [hallId, setHallId] = useState(boot.halls[0]?.id ?? '')
  const [open, setOpen] = useState<OpenReceipt[]>([])
  const [busyTables, setBusyTables] = useState<string[]>([])
  const [dialog, setDialog] = useState<'receipts' | 'type' | null>(null)
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

  async function openExisting(id: string) {
    try {
      onOpen(await api<Receipt>(`/pos/receipts/${id}`))
    } catch (err) {
      fail(err)
    }
  }

  const newOrder = () => {
    if (awaySales.length > 1) setDialog('type')
    else void start(awaySales[0] ? { saleTypeId: awaySales[0].id } : {})
  }

  return (
    <>
      <header className="bar" data-scene={/ter{1,2}as|тер{1,2}ас|ayvon|айвон/i.test(hall?.name ?? '') ? 'ocean' : 'hall'}>
        <div className="logo"><img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" /><span className="who">· {boot.user.name}</span></div>
        <button className="new" onClick={newOrder}>
          + {t('newOrder')}
        </button>
        {/* Справа три значка, как привыкли кассиры: выход, чеки, меню */}
        <button className="ico" onClick={logout} title={t('logout')} aria-label={t('logout')}>
          <svg viewBox="0 0 24 24">
            <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h11" />
          </svg>
        </button>
        <button className="ico" onClick={() => setDialog('receipts')} title={t('openReceipts')} aria-label={t('openReceipts')}>
          <svg viewBox="0 0 24 24">
            <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />
          </svg>
          {open.length > 0 && <span className="badge num">{open.length}</span>}
        </button>
        <button className="ico" onClick={onMenu} title={t('controlPanel')} aria-label={t('controlPanel')}>
          <svg viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      <div className="hall">
        {boot.halls.length > 1 && (
          <div className="tabs">
            {boot.halls.map((h) => (
              <button key={h.id} className={h.id === hall?.id ? 'on' : ''} onClick={() => setHallId(h.id)}>
                {h.name}
              </button>
            ))}
          </div>
        )}
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
                      <small className="num">{money(r.total)}</small>
                      <small>
                        {r.waiterName} · {minutes(r.openedAt)} {t('min')}
                      </small>
                    </>
                  ) : (
                    <small>{foreign ? '•••' : t('free')}</small>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {dialog === 'receipts' && (
        <Dialog title={t('openReceipts')} onClose={() => setDialog(null)}>
          {open.length === 0 ? (
            <div className="muted">{t('noOpenReceipts')}</div>
          ) : (
            <div className="list">
              {open.map((r) => (
                <button key={r.id} onClick={() => void openExisting(r.id)}>
                  <span>
                    {r.tableName ? `${t('table')} ${r.tableName}` : t('noTable')}
                    <small>
                      №{r.number} · {r.waiterName} · {minutes(r.openedAt)} {t('min')}
                    </small>
                  </span>
                  <b className="num">{money(r.total)}</b>
                </button>
              ))}
            </div>
          )}
        </Dialog>
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
