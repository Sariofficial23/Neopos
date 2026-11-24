import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api, money, type L10n, type Receipt } from './api'
import { useApp } from './app'
import type { Key } from './i18n'
import { DevicesDialog } from './Devices'
import { Dialog } from './Dialogs'
import { ReceiptsScreen } from './Receipts'
import { ReportDialog } from './Report'
import { desktop, guestReceipt, printSlips } from './print'

/** Значки плиток — простые линии, как в остальной кассе. */
const icons: Record<string, ReactNode> = {
  report: <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3M17 3v6M14 6h6" />,
  cash: <path d="M3 7h18v12H3zM3 11h18M7 15h3M16 3v4M12 3v4" />,
  menu: <path d="M4 4h7v16H4zM11 4h9v16h-9M14 9h3M14 13h3" />,
  logout: <path d="M14 4h6v16h-6M9 8l-4 4 4 4M5 12h11" />,
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

type Panel = 'receipts' | 'menu' | 'report' | 'cash' | 'archive' | 'staff' | 'devices' | null

/** «Панель управления» кассы: открывается кнопкой ☰ в правом верхнем углу. */
export function ControlPanel({ onBack, onOpenReceipt }: { onBack: () => void; onOpenReceipt: (r: Receipt) => void }) {
  const { boot, lang, t, can, toast, logout } = useApp()
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

  // «Архив чеков» — тот же большой экран «Чеки», сразу на закрытых.
  if (panel === 'archive') return <ReceiptsScreen initialTab="closed" onOpen={onOpenReceipt} onBack={() => setPanel(null)} />

  if (panel === 'receipts') return <ReceiptsScreen onOpen={onOpenReceipt} onBack={() => setPanel(null)} />

  return (
    <>
      <header className="bar">
        <button className="ico" onClick={onBack} title={t('back')} aria-label={t('back')}>
          <svg viewBox="0 0 24 24">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <div className="logo" style={{ marginLeft: 6 }}>
          {t('controlPanel')} · {boot.user.name}
        </div>
      </header>

      <div className="cp">
        <div className="cp-grid">
          <Tile icon="menu" tone="#925d30" label={t('dishMenu')} onClick={() => setPanel('menu')} />
          <Tile icon="archive" tone="#4d6691" label={t('receiptsTitle')} onClick={() => setPanel('receipts')} />
          <Tile icon="report" tone="#5b45e0" label={t('cpReport')} onClick={() => setPanel('report')} />
          {can('shift.cash_movement') && <Tile icon="cash" tone="#22b866" label={t('cpCash')} onClick={() => setPanel('cash')} />}
          <Tile icon="archive" tone="#ff9f0a" label={t('cpArchive')} onClick={() => setPanel('archive')} />
          {can('staff.edit') && <Tile icon="staff" tone="#bf5af2" label={t('cpStaff')} onClick={() => setPanel('staff')} />}
          <Tile icon="devices" tone="#5e5ce6" label={t('cpDevices')} onClick={() => setPanel('devices')} />
        </div>
        <div className="cp-grid cp-bottom">
          <Tile icon="refresh" tone="#5b45e0" label={t('cpRefresh')} onClick={() => void refresh()} />
          <Tile icon="logout" tone="#64748b" label={t('logout')} onClick={logout} />
          <Tile icon="fullscreen" tone="#64748b" label={t('cpFullscreen')} onClick={fullscreen} />
        </div>
      </div>

      {panel === 'menu' && (
        <Dialog title={t('dishMenu')} onClose={() => setPanel(null)}>
          <div className="hall-menu-list">
            {boot.products.length === 0 && <p>{t('nothingFound')}</p>}
            {boot.products.map((product) => (
              <div key={product.id}><span>{product.name[lang]}</span><b>{money(product.price)} {t('sum')}</b></div>
            ))}
          </div>
        </Dialog>
      )}
      {panel === 'report' && <ReportDialog onClose={() => setPanel(null)} />}
      {panel === 'cash' && <CashDialog onClose={() => setPanel(null)} />}

      {panel === 'staff' && <StaffDialog onClose={() => setPanel(null)} />}
      {panel === 'devices' && <DevicesDialog onClose={() => setPanel(null)} />}
    </>
  )
}

// ───────────── Добавить операцию: расход, доход, инкассация ─────────────

type FinanceCategory = { id: string; kind: 'expense' | 'income'; parentId: string | null; name: string; sort: number }
type OpType = 'expense' | 'income' | 'collection'

/**
 * «Добавить операцию», как в Clopos: по умолчанию «Расход».
 * Порядок полей: сумма → категория → описание. Инкассация — без категории.
 */
function CashDialog({ onClose }: { onClose: () => void }) {
  const { t, fail, toast } = useApp()
  const [type, setType] = useState<OpType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [note, setNote] = useState('')
  const [cats, setCats] = useState<FinanceCategory[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<FinanceCategory[]>('/pos/finance-categories').then(setCats).catch(fail)
  }, [fail])

  // Список для выбора: родитель, под ним его подкатегории с отступом.
  const options = useMemo(() => {
    if (!cats || type === 'collection') return []
    const own = cats.filter((c) => c.kind === type)
    const tops = own.filter((c) => !c.parentId)
    return tops.flatMap((top) => [
      { id: top.id, label: top.name },
      ...own.filter((c) => c.parentId === top.id).map((c) => ({ id: c.id, label: `   — ${c.name}` })),
    ])
  }, [cats, type])

  const pickType = (next: OpType) => {
    setType(next)
    setCategoryId('')
  }

  const valid = Number(amount) > 0 && (type === 'collection' || !!categoryId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    try {
      await api('/pos/shift/cash', {
        method: 'POST',
        body: { type, amount: Number(amount), categoryId: type === 'collection' ? null : categoryId, note: note.trim() || null },
      })
      toast(`${t(`op.${type}` as Key)}: ${money(Number(amount))}`)
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
        <div className="seg seg3" role="radiogroup" aria-label={t('opType')}>
          {(['expense', 'income', 'collection'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={type === k} className={type === k ? 'on' : ''} onClick={() => pickType(k)}>
              {t(`op.${k}` as Key)}
            </button>
          ))}
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
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 12))}
          />
        </label>
        {type !== 'collection' && (
          <label className="field">
            <span>{t('category')}</span>
            <select className="input" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" disabled>
                {cats ? t('chooseCategory') : t('loading')}
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t('description')}</span>
          <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn send wide" disabled={busy || !valid}>
          + {t('addOp')}
        </button>
      </form>
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
