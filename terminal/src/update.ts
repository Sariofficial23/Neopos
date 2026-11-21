import { useEffect, useState } from 'react'

/** Имя собранного скрипта кассы: меняется при каждой новой версии на Vercel. */
const scriptOf = (html: string) => /assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null
const current = () => {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')
  return el ? scriptOf(el.src) : null
}

/**
 * Касса открыта весь день и сама не узнаёт о новой версии.
 * Раз в 2 минуты сверяем версию с сайтом; если вышла новая — перезагружаемся,
 * но только когда кассой никто не пользуется (экран ПИН-кода), чтобы не прервать заказ.
 */
export function useAutoUpdate(idle: boolean) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const mine = current()
    if (!mine) return // режим разработки: скрипт не собран
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}?v=${Date.now()}`, { cache: 'no-store' })
        const latest = scriptOf(await res.text())
        if (latest && latest !== mine) setReady(true)
      } catch {
        /* нет интернета — проверим позже */
      }
    }
    const timer = window.setInterval(check, 2 * 60_000)
    window.addEventListener('online', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', check)
    }
  }, [])

  useEffect(() => {
    if (ready && idle) window.location.reload()
  }, [ready, idle])
}
