import { useCallback, useEffect, useState } from 'react'
import { api, API_BASE, ApiError, device } from './api'
import { Dialog } from './Dialogs'
import type { Key } from './i18n'
import { desktop, type NetState } from './print'

type T = (k: Key) => string
const KNOWN_ERRORS = ['no_sync', 'server_failed', 'not_found', 'not_synced']

/** Состояние локальной сети: есть только в приложении для Windows. Обновляется раз в 5 секунд. */
export function useNetState() {
  const [state, setState] = useState<NetState | null>(null)
  const load = useCallback(() => {
    if (!desktop?.netStatus) return
    desktop
      .netStatus()
      .then(setState)
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5000)
    return () => window.clearInterval(timer)
  }, [load])
  return state
}

type Kassa = { id: string; name: string; lastSeenAt: string | null; online: boolean; me: boolean; main: boolean }

/** Кассы заведения и их связь: с главного терминала (локальная сеть) или из облака. Обновляется раз в 5 секунд. */
function useKassas() {
  const [list, setList] = useState<Kassa[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      api<Kassa[]>('/pos/terminals', { as: 'device' })
        .then((v) => alive && setList(v))
        .catch(() => {})
    void load()
    const timer = window.setInterval(load, 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return list
}

/** Время; если это было не сегодня — с датой. */
const time = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${hm}`
}

/**
 * Окно «Локальная сеть» (экран ПИН-кода → ☰): сделать этот компьютер главным терминалом или
 * подключить кассу к главному терминалу. Любое переключение — по ПИН-коду администратора.
 */
export function LocalNetDialog({ t, tErr, onClose }: { t: T; tErr: (c: string) => string; onClose: () => void }) {
  const state = useNetState()
  const kassas = useKassas()
  /** Что будет выполнено после ввода ПИН-кода администратора */
  const [pending, setPending] = useState<null | { kind: 'main' } | { kind: 'lan'; host: string } | { kind: 'off' }>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<{ ip: string }[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [host, setHost] = useState('')

  if (!desktop?.netStatus || !state)
    return (
      <Dialog title={t('lanTitle')} onClose={onClose}>
        {/* Приложение есть, но старое: локальная сеть появилась в версии 0.2.0 */}
        <div className="muted">{desktop?.netStatus ? '…' : desktop ? t('lanNeedUpdate') : t('lanOnlyApp')}</div>
      </Dialog>
    )

  const ask = (next: NonNullable<typeof pending>) => {
    setError('')
    setPin('')
    setPending(next)
  }

  async function confirm() {
    if (!pending || !desktop) return
    setBusy(true)
    setError('')
    try {
      // Тот же запрос, что и при выходе из бренда: проверяет, что ПИН-код принадлежит администратору.
      await api('/pos/disconnect', { method: 'POST', body: { pin }, as: 'device' })
      const res =
        pending.kind === 'main'
          ? await desktop.netMainOn!({ token: device.get() ?? '', cloud: API_BASE || window.location.origin })
          : pending.kind === 'lan'
            ? await desktop.netLanOn!(pending.host)
            : await desktop.netOff!()
      // При успехе приложение само откроет кассу по новому адресу.
      if (!res.ok) setError(t(KNOWN_ERRORS.includes(res.error ?? '') ? (`lanErr.${res.error}` as Key) : 'lanErr.failed'))
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  async function search() {
    setSearching(true)
    setFound(null)
    try {
      setFound(await desktop!.netLanFind!())
    } finally {
      setSearching(false)
    }
  }

  if (pending)
    return (
      <Dialog title={t('lanTitle')} onClose={() => !busy && setPending(null)}>
        <div className="muted" style={{ marginTop: -8 }}>
          {pending.kind === 'main' ? t('lanMainConfirm') : pending.kind === 'lan' ? `${t('lanJoinConfirm')} ${pending.host}` : t('lanOffConfirm')}
        </div>
        <label className="field">
          <span>{t('lanAdminPin')}</span>
          <input
            className="input num"
            type="password"
            inputMode="numeric"
            autoFocus
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && !busy && void confirm()}
          />
        </label>
        <div className="err" role="alert">
          {busy && pending.kind === 'main' ? t('lanStarting') : error}
        </div>
        <button className="btn send wide" disabled={busy || pin.length < 4} onClick={() => void confirm()}>
          {busy ? '…' : t('lanConfirm')}
        </button>
      </Dialog>
    )

  const sync = state.sync
  return (
    <Dialog title={t('lanTitle')} onClose={onClose}>
      {state.mode !== 'lan' && (
        <>
          <label className="switch-row">
            <span>{t('lanMain')}</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={state.mode === 'main'}
              onChange={(e) => ask(e.target.checked ? { kind: 'main' } : { kind: 'off' })}
            />
          </label>
          <div className="muted" style={{ fontSize: 13 }}>
            {t('lanMainHint')}
          </div>
        </>
      )}

      {state.mode === 'main' && (
        <div className="lan-box">
          <div className="lan-line">
            <span>{t('lanCloud')}</span>
            <b className={sync?.online ? 'ok' : 'off'}>{sync?.online ? t('netOnline') : t('netOffline')}</b>
          </div>
          <div className="lan-line">
            <span>{t('lanLastSync')}</span>
            <b>{time(sync?.lastSyncAt)}</b>
          </div>
          {!!sync && !sync.online && (
            <div className="lan-line">
              <span>{t('lanPending')}</span>
              <b>{sync.pendingReceipts}</b>
            </div>
          )}
          <div className="lan-line">
            <span>{t('lanAddress')}</span>
            <b>{state.addresses.join(', ') || '—'}</b>
          </div>
        </div>
      )}

      {state.mode === 'lan' && (
        <>
          <div className="lan-box">
            <div className="lan-line">
              <span>{t('lanJoined')}</span>
              <b>{state.host}</b>
            </div>
            <div className="lan-line">
              <span>{t('lanCloud')}</span>
              <b className={sync?.online ? 'ok' : 'off'}>{sync ? (sync.online ? t('netOnline') : t('netOffline')) : '—'}</b>
            </div>
          </div>
          <button className="btn plain wide" onClick={() => ask({ kind: 'off' })}>
            {t('lanLeave')}
          </button>
        </>
      )}

      {kassas && kassas.length > 0 && (
        <>
          <h3 className="lan-h">
            {t('lanKassas')} · {kassas.filter((k) => k.online).length}/{kassas.length}
          </h3>
          <div className="lan-kassas">
            {kassas.map((k) => (
              <div key={k.id} className={`lan-kassa ${k.online ? 'on' : ''}`}>
                <i aria-hidden="true" />
                <span className="lan-kassa-name">
                  {k.name}
                  {k.main && <em>{t('lanTagMain')}</em>}
                  {k.me && <em>{t('lanTagMe')}</em>}
                </span>
                <b>{k.online ? t('lanConnected') : `${t('lanNotConnected')}${k.lastSeenAt ? ` · ${time(k.lastSeenAt)}` : ''}`}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {state.mode === 'cloud' && (
        <>
          <h3 className="lan-h">{t('lanJoinTitle')}</h3>
          <div className="muted" style={{ fontSize: 13, marginTop: -6 }}>
            {t('lanJoinHint')}
          </div>
          <button className="btn plain wide" disabled={searching} onClick={() => void search()}>
            {searching ? t('lanSearching') : t('lanSearch')}
          </button>
          {found && !found.length && <div className="muted">{t('lanNotFound')}</div>}
          {found?.map((f) => (
            <button key={f.ip} className="btn send wide" onClick={() => ask({ kind: 'lan', host: f.ip })}>
              {t('lanJoin')} · {f.ip}
            </button>
          ))}
          <div className="lan-manual">
            <input className="input num" placeholder="192.168.1.10" value={host} onChange={(e) => setHost(e.target.value.replace(/[^0-9.]/g, '').slice(0, 15))} />
            <button className="btn plain" disabled={!/^[0-9]+(\.[0-9]+){3}$/.test(host)} onClick={() => ask({ kind: 'lan', host })}>
              {t('lanJoin')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
