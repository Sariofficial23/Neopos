import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { dateTime, type Period } from '../period'
import { ErrorNote } from '../ui'

type Result = { text: string; generatedAt: string; model: string; cached: boolean }

/**
 * ИИ-сводка: по кнопке сервер собирает цифры за период и просит модель написать по ним короткий текст.
 * Сама не запускается — каждый запрос к модели платный, поэтому сводку заказывает владелец.
 */
export function AiSummary({ period }: { period: Period }) {
  const { t, tErr, lang } = useI18n()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ configured: boolean }>('/reports/ai-summary/status')
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(null))
  }, [])

  // Другой период — прежний текст к нему уже не относится.
  useEffect(() => {
    setResult(null)
    setError(null)
  }, [period])

  async function make(fresh: boolean) {
    setBusy(true)
    setError(null)
    try {
      setResult(await api<Result>('/reports/ai-summary', { method: 'POST', body: { from: period.from, to: period.to, lang, fresh } }))
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{t('aiTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('aiHint')}</p>
      </div>

      {configured === false ? (
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('aiOff')}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={busy} onClick={() => void make(!!result)}>
            {busy ? t('aiWorking') : result ? t('aiAgain') : t('aiMake')}
          </button>
          {result && (
            <span className="text-sm text-slate-500">
              {t('aiMade')}: {dateTime(result.generatedAt)}
              {result.cached ? ` · ${t('aiFromCache')}` : ''}
            </span>
          )}
        </div>
      )}

      <ErrorNote text={error} />

      {result && (
        <>
          <div className="whitespace-pre-wrap rounded-xl bg-brand-50 p-5 text-[15px] leading-relaxed text-slate-900">{result.text}</div>
          <p className="text-xs text-slate-500">{t('aiDisclaimer')}</p>
        </>
      )}
    </section>
  )
}
