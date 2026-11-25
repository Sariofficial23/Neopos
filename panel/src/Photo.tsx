import { useRef, useState } from 'react'
import { api, API_BASE, ApiError } from './api'
import { useI18n } from './i18n'

/** Плитка на кассе небольшая: 480 px по длинной стороне и до 180 КБ хватает с запасом. */
const SIDE = 480
const MAX_BYTES = 180_000

/** Уменьшает картинку в браузере и возвращает data:URL в WebP. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/webp', q)
    if ((url.length * 3) / 4 < MAX_BYTES) return url
  }
  throw new ApiError(413, 'image_too_big')
}

export const photoUrl = (image: string | null | undefined) => (image ? (image.startsWith('http') ? image : `${API_BASE}${image}`) : null)

/** Маленькая картинка товара или категории в списке; без фото — цветной квадрат. */
export function Thumb({ image, color }: { image: string | null | undefined; color?: string | null }) {
  const url = photoUrl(image)
  return url ? (
    <img src={url} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="block size-10 shrink-0 rounded-lg" style={{ background: color ?? '#e2e8f0' }} />
  )
}

/**
 * Фото товара или категории: показывается на плитке кассы. Загружается сразу, без кнопки «Сохранить».
 * path — например `/products/<id>`.
 */
export function PhotoField({ path, image, onChange }: { path: string; image: string | null | undefined; onChange: (image: string | null) => void }) {
  const { t, tErr } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = photoUrl(image)

  async function run(action: () => Promise<{ image: string | null }>) {
    setBusy(true)
    setError(null)
    try {
      onChange((await action()).image)
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <span className="label">{t('photo')}</span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="relative flex size-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-2xl text-slate-400 hover:border-brand-500"
          aria-label={url ? t('brandReplace') : t('brandUpload')}
        >
          {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : '+'}
          {busy && <span className="absolute inset-0 grid place-items-center bg-white/70 text-sm font-medium text-slate-700">…</span>}
        </button>
        <div className="space-y-1 text-sm">
          <div className="flex gap-3">
            <button type="button" className="cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => input.current?.click()}>
              {url ? t('brandReplace') : t('brandUpload')}
            </button>
            {url && (
              <button type="button" className="cursor-pointer font-medium text-red-600 hover:underline" disabled={busy} onClick={() => void run(() => api(`${path}/image`, { method: 'DELETE' }))}>
                {t('delete')}
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">{t('photoHint')}</p>
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void run(async () => api(`${path}/image`, { method: 'PUT', body: { image: await shrink(file) } }))
        }}
      />
    </div>
  )
}
