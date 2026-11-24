import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, device, type Lang } from './api'
import { useApp } from './app'
import { mediaUrl, NetStatus, type DeviceInfo } from './Brand'
import { DOWNLOAD_URL } from './download'
import type { Key } from './i18n'
import { desktop } from './print'

type Base = { t: (k: Key) => string; tErr: (c: string) => string; lang: Lang; setLang: (l: Lang) => void }

function LangPick({ lang, setLang }: Pick<Base, 'lang' | 'setLang'>) {
  return (
    <div className="lang">
      <button className={lang === 'uz' ? 'on' : ''} onClick={() => setLang('uz')}>
        O‘zbekcha
      </button>
      <button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>
        Русский
      </button>
    </div>
  )
}

/** Первый запуск на устройстве: вводят бренд и пароль терминала из панели (раздел «Терминалы»). */
export function Activate({ t, tErr, lang, setLang, onDone }: Base & { onDone: () => void }) {
  const [form, setForm] = useState({ brand: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ deviceToken: string }>('/pos/activate', { method: 'POST', body: form, as: 'none' })
      device.set(res.deviceToken)
      onDone()
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center" data-scene="ocean">
      <form className="card glass" onSubmit={submit}>
        <div className="brand"><img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" /></div>
        <div className="sub">{t('activateHint')}</div>
        <label className="field">
          <span>{t('brandField')}</span>
          <input
            className="input"
            required
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('terminalPassword')}</span>
          <input
            className="input num"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value.replace(/[^0-9A-Za-z]/g, '') })}
          />
        </label>
        <div className="err" role="alert">
          {error}
        </div>
        <button className="btn send wide" disabled={busy}>
          {t('connect')}
        </button>
        <LangPick lang={lang} setLang={setLang} />
        {DOWNLOAD_URL && !desktop && (
          <a className="btn plain wide" href={DOWNLOAD_URL} style={{ textDecoration: 'none' }}>
            ⬇ {t('downloadApp')}
          </a>
        )}
      </form>
    </div>
  )
}

const PIN_LEN = 4

/** Вход сотрудника: ПИН-код набирается пальцем или с клавиатуры. */
export function Pin({
  t,
  tErr,
  info,
  onToken,
  onDeviceLost,
}: Pick<Base, 't' | 'tErr'> & { info: DeviceInfo | null; onToken: (token: string) => void; onDeviceLost: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  // Меню «⋮» рядом с брендом: «Обновить» и «Выйти». Выход из бренда — только по ПИН-коду администратора.
  const [menuOpen, setMenuOpen] = useState(false)
  const [exiting, setExiting] = useState(false)

  async function refresh() {
    setMenuOpen(false)
    // В приложении для Windows сначала проверяем новую версию программы, затем заново загружаем кассу.
    if (desktop?.checkUpdate) {
      const res = await desktop.checkUpdate().catch(() => null)
      if (res?.status === 'installing') return
    }
    window.location.reload()
  }

  const submit = useCallback(
    async (value: string) => {
      setBusy(true)
      try {
        if (exiting) {
          await api('/pos/disconnect', { method: 'POST', body: { pin: value }, as: 'device' })
          return onDeviceLost()
        }
        const res = await api<{ token: string }>('/pos/pin', { method: 'POST', body: { pin: value }, as: 'device' })
        onToken(res.token)
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'internal'
        if (code === 'device_not_activated') return onDeviceLost()
        setError(tErr(code))
        setShake(true)
        window.setTimeout(() => setShake(false), 400)
        setPin('')
      } finally {
        setBusy(false)
      }
    },
    [onToken, onDeviceLost, tErr, exiting],
  )

  const press = useCallback(
    (d: string) => {
      if (busy) return
      setError('')
      setPin((cur) => {
        if (cur.length >= 6) return cur
        const next = cur + d
        // Четыре цифры — самый частый случай, входим сразу; для более длинных кодов есть кнопка «OK».
        if (next.length === PIN_LEN) window.setTimeout(() => void submit(next), 120)
        return next
      })
    },
    [busy, submit],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  return (
    <div className="center pin-screen" data-scene="ocean">
      {/* Слева — бренд заведения, справа — есть ли интернет */}
      <header className="pin-top">
        <div className="pin-left">
          <div className="venue">
            {info?.logo && <img src={mediaUrl(info.logo)} alt="" />}
            <span>{info?.venue}</span>
          </div>
          <div className="pin-menu">
            <button className="dots-btn" aria-label={t('more')} title={t('more')} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              ⋮
            </button>
            {menuOpen && (
              <>
                <div className="pin-menu-veil" onPointerDown={() => setMenuOpen(false)} />
                <div className="pin-menu-list glass" role="menu">
                  <button role="menuitem" onClick={() => void refresh()}>
                    ↻ {t('cpRefresh')}
                  </button>
                  <button
                    role="menuitem"
                    className="danger-text"
                    onClick={() => {
                      setMenuOpen(false)
                      setPin('')
                      setError('')
                      setExiting(true)
                    }}
                  >
                    ⎋ {t('exitBrand')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <NetStatus t={t} />
      </header>
      <div className="card glass">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" /></div>
        <div className="sub">{exiting ? t('exitPinHint') : t('enterPin')}</div>
        {exiting && (
          <button
            className="btn plain"
            style={{ justifySelf: 'center', height: 36, padding: '0 16px', fontSize: 13 }}
            onClick={() => {
              setExiting(false)
              setPin('')
              setError('')
            }}
          >
            ← {t('cancelExit')}
          </button>
        )}
        <div className={`dots ${shake ? 'shake' : ''}`} aria-label={`${pin.length}/${PIN_LEN}`}>
          {Array.from({ length: Math.max(PIN_LEN, pin.length) }, (_, i) => (
            <i key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        <div className="err" role="alert">
          {error}
        </div>
        <div className="pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <span />
          <button onClick={() => press('0')}>0</button>
          <button className="ghost" aria-label="Backspace" onClick={() => setPin((p) => p.slice(0, -1))}>
            ⌫
          </button>
        </div>
      </div>
    </div>
  )
}

/** Смена закрыта: продавать нельзя, пока её не откроют. */
export function ShiftGate() {
  const { t, can, fail, reloadBoot, logout, boot } = useApp()
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState(false)

  async function open(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/pos/shift/open', { method: 'POST', body: { openingCash: Number(cash) || 0 } })
      await reloadBoot()
    } catch (err) {
      fail(err)
      // Смену мог открыть кто-то с другой кассы — перечитываем состояние.
      await reloadBoot()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center" data-scene="ocean">
      <form className="card glass" onSubmit={open}>
        <div className="brand">{t('shiftClosed')}</div>
        <div className="sub">
          {boot.user.name} · {boot.venue}
        </div>
        {can('shift.open_close') ? (
          <>
            <label className="field">
              <span>
                {t('cashInDrawer')}, {t('sum')}
              </span>
              <input
                className="input num"
                inputMode="numeric"
                autoFocus
                placeholder="0"
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            </label>
            <button className="btn close wide" disabled={busy}>
              {t('openShift')}
            </button>
          </>
        ) : (
          <div className="sub">{t('shiftNoRight')}</div>
        )}
        <button type="button" className="btn plain wide" onClick={logout}>
          {t('logout')}
        </button>
      </form>
    </div>
  )
}
