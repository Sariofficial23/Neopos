import { useEffect, useState } from 'react'
import { api, API_BASE, type Lang } from './api'
import type { Key } from './i18n'

/** Что показывает экран ПИН-кода до входа: название, логотип и фото заведения, язык владельца. */
export type DeviceInfo = { venue: string; lang: Lang; logo: string | null; photo: string | null }

const INFO_KEY = 'neopos.device.info'

const cached = (): DeviceInfo | null => {
  try {
    const v = localStorage.getItem(INFO_KEY)
    return v ? (JSON.parse(v) as DeviceInfo) : null
  } catch {
    return null
  }
}

/** Данные заведения для экрана ПИН-кода: сначала из памяти (касса могла стартовать без интернета), затем с сервера. */
export function useDeviceInfo(hasDevice: boolean) {
  const [info, setInfo] = useState<DeviceInfo | null>(() => (hasDevice ? cached() : null))
  useEffect(() => {
    if (!hasDevice) return setInfo(null)
    let alive = true
    const load = () =>
      api<DeviceInfo>('/pos/device', { as: 'device' })
        .then((next) => {
          if (!alive) return
          setInfo(next)
          try {
            localStorage.setItem(INFO_KEY, JSON.stringify(next))
          } catch {
            /* нет хранилища */
          }
        })
        .catch(() => {
          /* без интернета остаёмся на сохранённых данных */
        })
    void load()
    // Владелец мог сменить логотип или фото в панели — подхватываем без перезапуска.
    const timer = window.setInterval(load, 10 * 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [hasDevice])
  return info
}

export const mediaUrl = (path: string) => `${API_BASE}${path}`

/** Фото заведения ставится фоном на всех экранах кассы вместо стандартных картинок. */
export function useVenuePhoto(path: string | null | undefined) {
  useEffect(() => {
    const body = document.body.style
    if (path) body.setProperty('--scene', `url("${mediaUrl(path)}")`)
    else body.removeProperty('--scene')
  }, [path])
}

/** Есть ли связь с сервером: проверяем не только сеть компьютера, но и ответ сервера NeoPos. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!navigator.onLine) return alive && setOnline(false)
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), 5000)
      try {
        const res = await fetch(`${API_BASE}/api/health`, { cache: 'no-store', signal: ctrl.signal })
        if (alive) setOnline(res.ok)
      } catch {
        if (alive) setOnline(false)
      } finally {
        window.clearTimeout(timer)
      }
    }
    void check()
    const timer = window.setInterval(check, 15_000)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
    }
  }, [])
  return online
}

/** Значок Wi-Fi с подписью: зелёный — есть интернет, красный — нет. */
export function NetStatus({ t }: { t: (k: Key) => string }) {
  const online = useOnline()
  return (
    <span className={`net ${online ? 'ok' : 'off'}`} role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" />
        <circle cx="12" cy="19" r="1.3" fill="currentColor" />
        {!online && <path d="M3 3l18 18" />}
      </svg>
      {online ? t('netOnline') : t('netOffline')}
    </span>
  )
}
