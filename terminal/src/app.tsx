import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, device, session, setSessionLostHandler, type Boot, type Lang, type Receipt } from './api'
import { Activate, Pin, ShiftGate } from './Auth'
import { useDeviceInfo, useTerminalPing, useVenuePhoto } from './Brand'
import { useAutoUpdate } from './update'
import { ControlPanel } from './ControlPanel'
import { Hall } from './Hall'
import { makeT, type Key } from './i18n'
import { setPrintContext } from './print'
import { Order } from './Order'

type AppCtx = {
  boot: Boot
  lang: Lang
  t: (k: Key) => string
  tErr: (code: string) => string
  can: (perm: string) => boolean
  toast: (text: string) => void
  /** Показывает ошибку запроса всплывающей строкой */
  fail: (err: unknown) => void
  reloadBoot: () => Promise<void>
  logout: () => void
}

const Ctx = createContext<AppCtx>(null!)
export const useApp = () => useContext(Ctx)

const LANG_KEY = 'neopos.pos.lang'
/** Через сколько минут бездействия касса снова спрашивает ПИН-код. */
const IDLE_MINUTES = 5

function savedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'uz' || v === 'ru') return v
  } catch {
    /* нет хранилища */
  }
  return 'uz'
}

export function App() {
  const [hasDevice, setHasDevice] = useState(() => device.get() !== null)
  const [token, setToken] = useState(() => session.get())
  const [boot, setBoot] = useState<Boot | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [uiLang, setUiLang] = useState<Lang>(savedLang)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const orderQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [signingOut, setSigningOut] = useState(false)
  const [hallId, setHallId] = useState('')
  const [menu, setMenu] = useState(false)
  const [toastText, setToastText] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const deviceInfo = useDeviceInfo(hasDevice)
  // Новая версия кассы ставится сама, когда никто не вошёл (экран ПИН-кода).
  useAutoUpdate(!token)
  // Фото заведения из панели — фоном на всех экранах кассы.
  useVenuePhoto(boot?.brand?.photo ?? deviceInfo?.photo)

  // До входа — язык владельца заведения (на первом подключении — выбранный вручную), после входа — язык сотрудника.
  const lang = boot?.user.lang ?? deviceInfo?.lang ?? uiLang
  const { t, tErr } = useMemo(() => makeT(lang), [lang])

  const pickLang = (l: Lang) => {
    setUiLang(l)
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* нет хранилища */
    }
  }

  const logout = useCallback(() => {
    session.set(null)
    setSigningOut(false)
    setToken(null)
    setBoot(null)
    setReceipt(null)
    setMenu(false)
  }, [])

  async function signOut() {
    setSigningOut(true)
    await orderQueue.current
    logout()
  }

  // Терминал удалили или выключили в панели — касса возвращается на экран подключения.
  const deviceLost = useCallback(() => {
    logout()
    device.set(null)
    setHasDevice(false)
  }, [logout])
  useTerminalPing(hasDevice, deviceLost)

  const toast = useCallback((text: string) => {
    setToastText(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastText(null), 2600)
  }, [])

  const fail = useCallback(
    (err: unknown) => toast(tErr(err instanceof ApiError ? err.code : 'internal')),
    [toast, tErr],
  )

  const reloadBoot = useCallback(async () => {
    try {
      const currentSession = session.get()
      const nextBoot = await api<Boot>('/pos/bootstrap')
      if (session.get() !== currentSession) return
      setBoot(nextBoot)
      setBootError(null)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setBootError(err instanceof ApiError ? err.code : 'internal')
    }
  }, [])

  useEffect(() => {
    setSessionLostHandler(logout)
  }, [logout])

  // Печать знает, какие сетевые принтеры у заведения и на каком языке писать ошибки.
  useEffect(() => {
    if (boot) setPrintContext(boot.printers ?? [], boot.user.lang)
  }, [boot])

  useEffect(() => {
    if (token) void reloadBoot()
  }, [token, reloadBoot])

  // Автоматический выход при бездействии: касса не должна оставаться открытой под чужим именем.
  useEffect(() => {
    if (!token) return
    let timer = window.setTimeout(logout, IDLE_MINUTES * 60_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(logout, IDLE_MINUTES * 60_000)
    }
    const events = ['pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, reset))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [token, logout])

  function showReceipt(next: Receipt) {
    if (token && session.get() === token) setReceipt(next)
  }

  let screen: ReactNode
  if (!hasDevice) {
    screen = <Activate t={t} tErr={tErr} lang={lang} setLang={pickLang} onDone={() => setHasDevice(true)} />
  } else if (!token) {
    screen = (
      <Pin
        t={t}
        tErr={tErr}
        info={deviceInfo}
        onToken={(tk) => {
          session.set(tk)
          setToken(tk)
        }}
        onDeviceLost={() => {
          device.set(null)
          setHasDevice(false)
        }}
      />
    )
  } else if (!boot) {
    screen = (
      <div className="center">
        <div className="card glass">
          <div className="brand"><img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" /></div>
          <div className={bootError ? 'err' : 'sub'}>{bootError ? tErr(bootError) : t('loading')}</div>
          {bootError && (
            <button className="btn plain" onClick={() => void reloadBoot()}>
              ↻
            </button>
          )}
        </div>
      </div>
    )
  } else {
    const ctx: AppCtx = {
      boot,
      lang,
      t,
      tErr,
      can: (perm) => boot.user.role.permissions.includes(perm),
      toast,
      fail,
      reloadBoot,
      logout,
    }
    screen = (
      <Ctx.Provider value={ctx}>
        {!boot.shift ? (
          <ShiftGate />
        ) : receipt ? (
          <Order queue={orderQueue} receipt={receipt} setReceipt={showReceipt} onBack={() => setReceipt(null)} />
        ) : menu ? (
          <ControlPanel
            onBack={() => setMenu(false)}
            onOpenReceipt={(r) => {
              setMenu(false)
              showReceipt(r)
            }}
          />
        ) : (
          <Hall hallId={hallId} setHallId={setHallId} onOpen={showReceipt} onMenu={() => setMenu(true)} />
        )}
      </Ctx.Provider>
    )
  }

  return (
    <>
      {hasDevice && token && (
        <div className="session-bar">
          <button type="button" disabled={signingOut} onClick={() => void signOut()}>
            {boot && <span className="session-name">{boot.user.name}</span>}
            <strong>{t('logout')}</strong>
          </button>
        </div>
      )}
      {screen}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </>
  )
}
