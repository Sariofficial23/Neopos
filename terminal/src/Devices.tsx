import { useEffect, useState, type FormEvent } from 'react'
import { api, type NetPrinter } from './api'
import { useApp } from './app'
import { Dialog, PrinterSetting } from './Dialogs'
import { DOWNLOAD_URL } from './download'
import { desktop, testNetPrinter } from './print'

type Device = { id: string; name: string; active: boolean; lastSeenAt: string | null; current: boolean }
type PrinterDraft = {
  id?: string
  name: string
  ip: string
  port: string
  width: 80 | 58
  departmentIds: string[]
  receipts: boolean
  active: boolean
}

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

/** «Устройства», как в Clopos: вкладки «Принтеры» (сетевые, по IP, с отделами) и «Кассы». */
export function DevicesDialog({ onClose }: { onClose: () => void }) {
  const { t, can } = useApp()
  const [tab, setTab] = useState<'printers' | 'kassas'>('printers')
  const [draft, setDraft] = useState<PrinterDraft | null>(null)

  return (
    <Dialog title={draft ? (draft.id ? draft.name : t('addPrinter')) : t('cpDevices')} onClose={draft ? () => setDraft(null) : onClose}>
      {draft ? (
        <PrinterForm draft={draft} setDraft={setDraft} onDone={() => setDraft(null)} />
      ) : (
        <>
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'printers'} className={tab === 'printers' ? 'on' : ''} onClick={() => setTab('printers')}>
              {t('printersTab')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'kassas'} className={tab === 'kassas' ? 'on' : ''} onClick={() => setTab('kassas')}>
              {t('kassaDevices')}
            </button>
          </div>
          {tab === 'printers' ? (
            <PrintersTab
              canEdit={can('settings.edit')}
              onAdd={() => setDraft({ name: '', ip: '', port: '9100', width: 80, departmentIds: [], receipts: false, active: true })}
              onEdit={(p) => setDraft({ ...p, port: String(p.port), width: p.width === 58 ? 58 : 80 })}
            />
          ) : (
            <KassasTab />
          )}
        </>
      )}
    </Dialog>
  )
}

function PrintersTab({ canEdit, onAdd, onEdit }: { canEdit: boolean; onAdd: () => void; onEdit: (p: NetPrinter) => void }) {
  const { t, boot, toast } = useApp()
  const [testing, setTesting] = useState<string | null>(null)
  const depName = (id: string) => boot.departments.find((d) => d.id === id)?.name ?? '?'
  const network = !!desktop?.printNet

  async function test(p: NetPrinter) {
    setTesting(p.id)
    const err = await testNetPrinter(p, boot.venue)
    setTesting(null)
    toast(err ? `${p.name}: ${t('printFailed')} — ${err}` : `${p.name}: ${t('printerOk')}`)
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {!network && (
        <div className="note-box">
          {desktop ? t('restartToUpdate') : t('netPrintNeedsApp')}{' '}
          {DOWNLOAD_URL && !desktop && (
            <a href={DOWNLOAD_URL} style={{ fontWeight: 700 }}>
              {t('downloadApp')}
            </a>
          )}
        </div>
      )}
      {boot.printers.length === 0 ? (
        <div className="muted">{t('noPrinters')}</div>
      ) : (
        <div className="list" style={{ maxHeight: '44vh' }}>
          {boot.printers.map((p) => (
            <div key={p.id} className={`printer-row ${p.active ? '' : 'off'}`}>
              <div className="printer-ico" aria-hidden="true">
                🖨️
              </div>
              <div className="printer-info">
                <b>{p.name}</b>
                <small className="num">
                  {p.ip}:{p.port} · {p.width} {t('mm')}
                </small>
                <span className="chips">
                  {p.receipts && <span className="chip strong">{t('guestChecks')}</span>}
                  {p.departmentIds.map((d) => (
                    <span key={d} className="chip">
                      {depName(d)}
                    </span>
                  ))}
                  {!p.receipts && p.departmentIds.length === 0 && <span className="chip warn">{t('nothingAssigned')}</span>}
                </span>
              </div>
              <div className="printer-actions">
                {network && (
                  <button type="button" className="btn plain" disabled={testing === p.id} onClick={() => void test(p)}>
                    {t('test')}
                  </button>
                )}
                {canEdit && (
                  <button type="button" className="btn plain" aria-label={t('edit')} onClick={() => onEdit(p)}>
                    ✎
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <button type="button" className="btn send wide" onClick={onAdd}>
          + {t('addPrinter')}
        </button>
      )}
      {desktop && (
        <details className="sys-printer">
          <summary>{t('windowsPrinter')}</summary>
          <PrinterSetting />
        </details>
      )}
    </div>
  )
}

function PrinterForm({ draft, setDraft, onDone }: { draft: PrinterDraft; setDraft: (d: PrinterDraft) => void; onDone: () => void }) {
  const { t, boot, fail, toast, reloadBoot } = useApp()
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ ip: string }[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const up = (patch: Partial<PrinterDraft>) => setDraft({ ...draft, ...patch })
  const ipOk = IP_RE.test(draft.ip.trim())

  async function scan() {
    if (!desktop?.scanPrinters) return
    setScanning(true)
    try {
      setFound(await desktop.scanPrinters())
    } finally {
      setScanning(false)
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const body = {
        name: draft.name.trim(),
        ip: draft.ip.trim(),
        port: Number(draft.port) || 9100,
        width: draft.width,
        departmentIds: draft.departmentIds,
        receipts: draft.receipts,
        active: draft.active,
      }
      if (draft.id) await api(`/pos/printers/${draft.id}`, { method: 'PATCH', body })
      else await api('/pos/printers', { method: 'POST', body })
      await reloadBoot()
      toast(t('saved'))
      onDone()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!draft.id || !window.confirm(`${draft.name}: ${t('confirmDeletePrinter')}`)) return
    setBusy(true)
    try {
      await api(`/pos/printers/${draft.id}`, { method: 'DELETE' })
      await reloadBoot()
      onDone()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const toggleDep = (id: string) =>
    up({ departmentIds: draft.departmentIds.includes(id) ? draft.departmentIds.filter((d) => d !== id) : [...draft.departmentIds, id] })

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <label className="field">
        <span>{t('printerName')}</span>
        <input
          className="input"
          required
          maxLength={60}
          autoFocus
          placeholder={t('printerNameHint')}
          value={draft.name}
          onChange={(e) => up({ name: e.target.value })}
        />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 3 }}>
          <span>{t('ipAddress')}</span>
          <input
            className="input num"
            required
            inputMode="decimal"
            placeholder="192.168.1.100"
            value={draft.ip}
            onChange={(e) => up({ ip: e.target.value.replace(/[^\d.]/g, '').slice(0, 15) })}
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>{t('port')}</span>
          <input className="input num" inputMode="numeric" value={draft.port} onChange={(e) => up({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
        </label>
      </div>
      {desktop?.scanPrinters && (
        <div style={{ display: 'grid', gap: 6 }}>
          <button type="button" className="btn plain wide" disabled={scanning} onClick={() => void scan()}>
            {scanning ? t('scanning') : `🔎 ${t('findPrinters')}`}
          </button>
          {found &&
            (found.length === 0 ? (
              <div className="muted">{t('noneFound')}</div>
            ) : (
              <div className="quick">
                {found.map((f) => (
                  <button type="button" key={f.ip} className={draft.ip === f.ip ? 'on' : ''} onClick={() => up({ ip: f.ip })}>
                    {f.ip}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
      <div className="field">
        <span>{t('paperWidth')}</span>
        <div className="seg">
          {([80, 58] as const).map((w) => (
            <button key={w} type="button" className={draft.width === w ? 'on' : ''} onClick={() => up({ width: w })}>
              {w} {t('mm')}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('printsDepartments')}</span>
        <div className="quick">
          {boot.departments.map((d) => (
            <button type="button" key={d.id} className={draft.departmentIds.includes(d.id) ? 'on' : ''} onClick={() => toggleDep(d.id)}>
              {draft.departmentIds.includes(d.id) ? '✓ ' : ''}
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={draft.receipts} onChange={(e) => up({ receipts: e.target.checked })} />
        <span>{t('printsGuestChecks')}</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={draft.active} onChange={(e) => up({ active: e.target.checked })} />
        <span>{t('printerActive')}</span>
      </label>
      <div className="row">
        {draft.id && (
          <button type="button" className="btn plain" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => void remove()}>
            {t('remove')}
          </button>
        )}
        <button className="btn send" disabled={busy || !ipOk || !draft.name.trim()}>
          {t('save')}
        </button>
      </div>
    </form>
  )
}

function KassasTab() {
  const { t, fail } = useApp()
  const [devices, setDevices] = useState<Device[] | null>(null)
  useEffect(() => {
    api<Device[]>('/pos/devices').then(setDevices).catch(fail)
  }, [fail])
  const seen = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  if (!devices) return <div className="muted">{t('loading')}</div>
  return (
    <div className="list" style={{ maxHeight: '50vh' }}>
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
  )
}
