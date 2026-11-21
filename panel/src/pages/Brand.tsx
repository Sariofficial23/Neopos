import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_BASE, ApiError } from '../api'
import { useI18n } from '../i18n'
import { ErrorNote } from '../ui'

type Kind = 'logo' | 'photo'
type Images = { logo: string | null; photo: string | null }

/** Логотип — до 512 px, фото заведения — до 1920 px; всё в WebP, чтобы касса грузилась быстро. */
const LIMITS: Record<Kind, { side: number; bytes: number }> = {
  logo: { side: 512, bytes: 280_000 },
  photo: { side: 1920, bytes: 1_900_000 },
}

/** Уменьшает картинку в браузере и возвращает data:URL в WebP. */
async function shrink(file: File, kind: Kind): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const { side, bytes } = LIMITS[kind]
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  for (const q of [0.85, 0.75, 0.6, 0.45]) {
    const url = canvas.toDataURL('image/webp', q)
    if ((url.length * 3) / 4 < bytes) return url
  }
  throw new ApiError(413, 'image_too_big')
}

/** «Оформление кассы»: владелец сам ставит логотип и фото своего заведения. */
export function BrandCard() {
  const { t, tErr } = useI18n()
  const [images, setImages] = useState<Images | null>(null)
  const [busy, setBusy] = useState<Kind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputs = { logo: useRef<HTMLInputElement>(null), photo: useRef<HTMLInputElement>(null) }

  const errText = useCallback((err: unknown) => tErr(err instanceof ApiError ? err.code : 'internal'), [tErr])

  useEffect(() => {
    api<Images>('/brand')
      .then(setImages)
      .catch((err) => setError(errText(err)))
  }, [errText])

  async function upload(kind: Kind, file: File | undefined) {
    if (!file) return
    setBusy(kind)
    setError(null)
    try {
      const image = await shrink(file, kind)
      setImages(await api<Images>(`/brand/${kind}`, { method: 'PUT', body: { image } }))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(null)
      const input = inputs[kind].current
      if (input) input.value = ''
    }
  }

  async function remove(kind: Kind) {
    setBusy(kind)
    try {
      setImages(await api<Images>(`/brand/${kind}`, { method: 'DELETE' }))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(null)
    }
  }

  const slot = (kind: Kind) => {
    const url = images?.[kind]
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium">{t(kind === 'logo' ? 'brandLogo' : 'brandPhoto')}</div>
        <button
          type="button"
          onClick={() => inputs[kind].current?.click()}
          className={`relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 hover:border-brand-500 ${kind === 'logo' ? 'h-32' : 'aspect-video'}`}
        >
          {url ? (
            <img src={`${API_BASE}${url}`} alt="" className={`h-full w-full ${kind === 'logo' ? 'object-contain p-3' : 'object-cover'}`} />
          ) : (
            <span>+ {t('brandUpload')}</span>
          )}
          {busy === kind && <span className="absolute inset-0 grid place-items-center bg-white/70 font-medium">{t('loading')}</span>}
        </button>
        <input ref={inputs[kind]} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload(kind, e.target.files?.[0])} />
        <div className="flex gap-3 text-sm">
          <button type="button" className="cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => inputs[kind].current?.click()}>
            {url ? t('brandReplace') : t('brandUpload')}
          </button>
          {url && (
            <button type="button" className="cursor-pointer font-medium text-red-600 hover:underline" onClick={() => void remove(kind)}>
              {t('delete')}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">{t(kind === 'logo' ? 'brandLogoHint' : 'brandPhotoHint')}</p>
      </div>
    )
  }

  return (
    <section className="card space-y-4 p-5">
      <h2 className="font-semibold">{t('brandTitle')}</h2>
      <ErrorNote text={error} />
      {!images && !error ? (
        <div className="text-sm text-slate-500">{t('loading')}</div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          {slot('logo')}
          {slot('photo')}
        </div>
      )}
    </section>
  )
}
