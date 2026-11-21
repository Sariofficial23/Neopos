import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, money, type L10n, type Receipt } from './api'
import { useApp } from './app'
import { Dialog, PrinterSetting, ShiftDialog } from './Dialogs'
import { DOWNLOAD_URL } from './download'
import { desktop, guestReceipt, printSlips } from './print'

/** Значки плиток — простые линии, как в остальной кассе. */
const icons: Record<string, ReactNode> = {
  report: <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3M17 3v6M14 6h6" />,
  cash: <path d="M3 7h18v12H3zM3 11h18M7 15h3M16 3v4M12 3v4" />,
  archive: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M15 19a3 3 0 1 0 0-.01" />,
  staff: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M19 8v6M16 11h6" />
    </>
  ),
  devices: <path d="M3 5h12v9H3zM6 18h6M9 14v4M17 9h4v10h-4zM19 16v.01" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
}

function Tile({ icon, label, onClick, tone }: { icon: string; label: string; onClick: () => void; tone: string }) {
  return (
    <button className="cp-tile glass" onClick={onClick}>
      <span className="cp-ico" style={{ ['--tone' as string]: tone }}>
        <svg viewBox="0 0 24 24">{icons[icon]}</svg>
      </span>
      <span>{label}</span>
    </button>
  )
}

type Panel = 'report' | 'cash' | 'archive' | 'staff' | 'devices' | null

/** «Панель управления» кассы: открывается кнопкой ☰ в правом верхнем углу. */
export function ControlPanel({ onBack }: { onBack: () => void }) {
  const { t, can, toast } = useApp()
  const [panel, setPanel] = useState<Panel>(null)

  async function refresh() {
    // В приложении для Windows сначала проверяем новую версию программы, затем обновляем экран кассы.
    if (desktop?.checkUpdate) {
      toast(t('checkingUpdate'))
      const res = await desktop.checkUpdate()
      if (res.status === 'installing') {
        toast(`${t('installingUpdate')} ${res.version ?? ''}`)
        return
      }
    }
    window.location.reload()
  }

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  return (
    <>
      <header className="bar">
        <button className="ico" onClick={onBack} title={t('back')} aria-label={t('back')}>
          <svg viewBox="0 0 24 24">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <div className="logo" style={{ marginLeft: 6 }}>
          {t('controlPanel')}
        </div>
      </header>

      <div className="cp">
        <div className="cp-grid">
          <Tile icon="report" tone="#0a84ff" label={t('cpReport')} onClick={() => setPanel('report')} />
          {can('shift.cash_movement') && <Tile icon="cash" tone="#22b866" label={t('cpCash')} onClick={() => setPanel('cash')} />}
          <Tile icon="archive" tone="#ff9f0a" label={t('cpArchive')} onClick={() => setPanel('archive')} />
          {can('staff.edit') && <Tile icon="staff" tone="#bf5af2" label={t('cpStaff')} onClick={() => setPanel('staff')} />}
          <Tile icon="devices" tone="#5e5ce6" label={t('cpDevices')} onClick={() => setPanel('devices')} />
        </div>
        <div className="cp-grid cp-bottom">
          <Tile icon="refresh" tone="#0a84ff" label={t('cpRefresh')} onClick={() => void refresh()} />
          <Tile icon="fullscreen" tone="#64748b" label={t('cpFullscreen')} onClick={fullscreen} />
        </div>
      </div>

      {panel === 'report' && <ShiftDialog onClose={() => setPanel(null)} />}
      {panel === 'cash' && <CashDialog onClose={() => setPanel(null)} />}
      {panel === 'archive' && <ArchiveDialog onClose={() => setPanel(null)} />}
      {panel === 'staff' && <StaffDialog onClose={() => setPanel(null)} />}
      {panel === 'devices' && <DevicesDialog onClose={() => setPanel(null)} />}
    </>
  )
}

// ───────────── Добавить операцию: внесение или изъятие наличных ─────────────

function CashDialog({ onClose }: { onClose: () => void }) {
  const { t, fail, toast } = useApp()
  const [kind, setKind] = useState<'out' | 'in'>('out')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const quick = kind === 'out' ? [t('qProducts'), t('qSupplies'), t('qTaxi'), t('qSalary')] : [t('qChange'), t('qOwner')]

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/pos/shift/cash', { method: 'POST', body: { kind, amount: Number(amount), note } })
      toast(`${kind === 'out' ? t('cashOut') : t('cashIn')}: ${money(Number(amount))}`)
      onClose()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('cpCash')} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <div className="seg">
          <button type="button" className={kind === 'out' ? 'on' : ''} onClick={() => setKind('out')}>
            {t('cashOut')}
          </button>
          <button type="button" className={kind === 'in' ? 'on' : ''} onClick={() => setKind('in')}>
            {t('cashIn')}
          </button>
        </div>
        <label className="field">
          <span>
            {t('amount')}, {t('sum')}
          </span>
          <input
            className="input num"
            inputMode="numeric"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 12))}
          />
        </label>
        <label className="field">
          <span>{t('comment')}</span>
          <input className="input" required maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="quick">
          {quick.map((q) => (
            <button type="button" key={q} onClick={() => setNote(q)}>
              {q}
            </button>
          ))}
        </div>
        <button className="btn send wide" disabled={busy || !Number(amount) || !note.trim()}>
          {t('save')}
        </button>
      </form>
    </Dialog>
  )
}

// ───────────── Архив чеков текущей смены ─────────────

type ArchiveRow = {
  id: string
  number: number
  status: string
  tableName: string | null
  saleTypeId: string | null
  waiterName: string | null
  total: number
  closedAt: string | null
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }) : ''

function ArchiveDialog({ onClose }: { onClose: () => void }) {
  const { t, lang, boot, fail, toast } = useApp()
  const [rows, setRows] = useState<ArchiveRow[] | null>(null)
  const [open, setOpen] = useState<Receipt | null>(null)

  useEffect(() => {
    api<{ receipts: ArchiveRow[] }>('/pos/archive')
      .then((r) => setRows(r.receipts))
      .catch(fail)
  }, [fail])

  const place = (r: { tableName: string | null; saleTypeId: string | null }) =>
    r.tableName ? `${t('table')} ${r.tableName}` : (boot.saleTypes.find((s) => s.id === r.saleTypeId)?.name[lang] ?? t('noTable'))

  async function show(id: string) {
    try {
      setOpen(await api<Receipt>(`/pos/receipts/${id}`))
    } catch (err) {
      fail(err)
    }
  }

  async function reprint(r: Receipt) {
    const err = await printSlips([guestReceipt(r, boot, lang, { final: true })])
    if (err) toast(`${t('printFailed')}: ${err}`)
  }

  if (open) {
    const live = open.items.filter((i) => !i.voided)
    return (
      <Dialog title={`№${open.number} · ${place(open)}`} onClose={() => setOpen(null)}>
        <div className="list" style={{ gap: 4 }}>
          {live.map((i) => (
            <div key={i.id} className="kv">
              <span>
                {i.qty / 1000} × {i.name[lang]}
              </span>
              <b className="num">{money(i.total)}</b>
            </div>
          ))}
        </div>
        <div className="kv total">
          <span>{t('toPay')}</span>
          <b className="num">{money(open.total)}</b>
        </div>
        {open.payments.map((p, idx) => (
          <div key={idx} className="kv">
            <span>{(p.name as L10n)[lang]}</span>
            <span className="num">{money(p.amount)}</span>
          </div>
        ))}
        <div className="row">
          <button className="btn plain" onClick={() => setOpen(null)}>
            {t('back')}
          </button>
          {open.status === 'closed' && (
            <button className="btn send" onClick={() => void reprint(open)}>
              {t('reprint')}
            </button>
          )}
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title={t('cpArchive')} onClose={onClose}>
      {!rows ? (
        <div className="muted">{t('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="muted">{t('archiveEmpty')}</div>
      ) : (
        <div className="list">
          {rows.map((r) => (
            <button key={r.id} onClick={() => void show(r.id)}>
              <span>
                №{r.number} · {place(r)}
                <small>
                  {time(r.closedAt)} · {r.waiterName}
                  {r.status === 'cancelled' ? ` · ${t('cancelled')}` : ''}
                </small>
              </span>
              <b className="num">{money(r.total)}</b>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

// ───────────── Сотрудник: быстро добавить с ПИН-кодом ─────────────

type RoleRow = { id: string; name: string; isOwner: boolean; terminalAccess: boolean }
type StaffRow = { id: string; name: string; roleName: string; hasPin: boolean; active: boolean }

function StaffDialog({ onClose }: { onClose: () => void }) {
  const { t, fail, toast } = useApp()
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [form, setForm] = useState({ name: '', roleId: '', pin: '' })
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const [r, s] = await Promise.all([api<RoleRow[]>('/roles'), api<StaffRow[]>('/staff')])
      const usable = r.filter((x) => !x.isOwner && x.terminalAccess)
      setRoles(usable)
      setStaff(s)
      setForm((f) => (f.roleId ? f : { ...f, roleId: usable[usable.length - 1]?.id ?? '' }))
    } catch (err) {
      fail(err)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/staff', { method: 'POST', body: { name: form.name, roleId: form.roleId, pin: form.pin } })
      toast(`${t('staffAdded')}: ${form.name}`)
      setForm({ ...form, name: '', pin: '' })
      await load()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('cpStaff')} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          <span>{t('staffName')}</span>
          <input className="input" required minLength={2} maxLength={80} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="row">
          <label className="field">
            <span>{t('role')}</span>
            <select className="input" required value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('pinLabel')}</span>
            <input
              className="input num"
              inputMode="numeric"
              required
              pattern="\d{4,6}"
              maxLength={6}
              autoComplete="off"
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
            />
          </label>
        </div>
        <button className="btn send wide" disabled={busy || !form.roleId}>
          + {t('addStaff')}
        </button>
      </form>
      {staff && (
        <div className="list" style={{ maxHeight: '32vh' }}>
          {staff
            .filter((s) => s.active)
            .map((s) => (
              <div key={s.id} className="kv">
                <span>
                  {s.name} <small className="muted">· {s.roleName}</small>
                </span>
                <span className="muted">{s.hasPin ? 'PIN ✓' : '—'}</span>
              </div>
            ))}
        </div>
      )}
    </Dialog>
  )
}

// ───────────── Устройства: принтер и кассы ─────────────

type Device = { id: string; name: string; active: boolean; lastSeenAt: string | null; current: boolean }

function DevicesDialog({ onClose }: { onClose: () => void }) {
  const { t, fail } = useApp()
  const [devices, setDevices] = useState<Device[] | null>(null)

  useEffect(() => {
    api<Device[]>('/pos/devices').then(setDevices).catch(fail)
  }, [fail])

  const seen = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <Dialog title={t('cpDevices')} onClose={onClose}>
      {desktop ? (
        <PrinterSetting />
      ) : (
        <div className="muted" style={{ fontSize: 14 }}>
          {t('printerBrowserNote')}{' '}
          {DOWNLOAD_URL && (
            <a href={DOWNLOAD_URL} style={{ fontWeight: 700 }}>
              {t('downloadApp')}
            </a>
          )}
        </div>
      )}
      <div className="field">
        <span>{t('kassaDevices')}</span>
      </div>
      {!devices ? (
        <div className="muted">{t('loading')}</div>
      ) : (
        <div className="list" style={{ maxHeight: '36vh' }}>
          {devices.map((d) => (
            <div key={d.id} className="kv">
              <span>
                {d.current ? '● ' : ''}
                {d.name}
                {d.current && <small className="muted"> · {t('thisDevice')}</small>}
              </span>
              <span className="muted num">{seen(d.lastSeenAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
