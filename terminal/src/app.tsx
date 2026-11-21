import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, device, session, setSessionLostHandler, type Boot, type Lang, type Receipt } from './api'
import { Activate, Pin, ShiftGate } from './Auth'
import { Hall } from './Hall'
import { makeT, type Key } from './i18n'
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
  const [toastText, setToastText] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // До входа язык выбирается на экране ПИН-кода, после входа — язык сотрудника.
  const lang = boot?.user.lang ?? uiLang
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
    setToken(null)
    setBoot(null)
    setReceipt(null)
  }, [])

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
      setBoot(await api<Boot>('/pos/bootstrap'))
      setBootError(null)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setBootError(err instanceof ApiError ? err.code : 'internal')
    }
  }, [])

  useEffect(() => {
    setSessionLostHandler(logout)
  }, [logout])

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

  let screen: ReactNode
  if (!hasDevice) {
    screen = <Activate t={t} tErr={tErr} lang={lang} setLang={pickLang} onDone={() => setHasDevice(true)} />
  } else if (!token) {
    screen = (
      <Pin
        t={t}
        tErr={tErr}
        lang={lang}
        setLang={pickLang}
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
          <Order receipt={receipt} setReceipt={setReceipt} onBack={() => setReceipt(null)} />
        ) : (
          <Hall onOpen={setReceipt} />
        )}
      </Ctx.Provider>
    )
  }

  return (
    <>
      {screen}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </>
  )
}
