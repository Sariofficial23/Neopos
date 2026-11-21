import { useCallback, useEffect, useState } from 'react'
import { api, money, type OpenReceipt, type Receipt } from './api'
import { useApp } from './app'
import { Dialog, ShiftDialog } from './Dialogs'

/** Сколько минут открыт чек */
const minutes = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))

export function Hall({ onOpen }: { onOpen: (r: Receipt) => void }) {
  const { boot, t, lang, fail, logout } = useApp()
  const [hallId, setHallId] = useState(boot.halls[0]?.id ?? '')
  const [open, setOpen] = useState<OpenReceipt[]>([])
  const [busyTables, setBusyTables] = useState<string[]>([])
  const [dialog, setDialog] = useState<'receipts' | 'shift' | 'user' | 'type' | null>(null)
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
      <header className="bar">
        <div className="logo">NeoPos</div>
        <button className="new" onClick={newOrder}>
          + {t('newOrder')}
        </button>
        <button className="lnk" onClick={() => setDialog('receipts')}>
          {t('receipts')} <span className="n num">{open.length}</span>
        </button>
        <button className="lnk" onClick={() => setDialog('user')}>
          {boot.user.name}
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
                  className={`table glass ${r ? 'busy' : foreign ? 'other' : ''}`}
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
          <div className="list">
            {awaySales.map((s) => (
              <button key={s.id} onClick={() => void start({ saleTypeId: s.id })}>
                {s.name[lang]}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {dialog === 'user' && (
        <Dialog title={boot.user.name} onClose={() => setDialog(null)}>
          <div className="muted" style={{ marginTop: -8 }}>
            {boot.user.role.name} · {boot.venue}
          </div>
          <button className="btn plain wide" onClick={() => setDialog('shift')}>
            {t('shift')} №{boot.shift?.number}
          </button>
          <button className="btn plain wide" onClick={logout}>
            {t('logout')}
          </button>
        </Dialog>
      )}

      {dialog === 'shift' && <ShiftDialog onClose={() => setDialog(null)} />}
    </>
  )
}
