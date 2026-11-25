import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { dateTime, type Period } from '../period'
import { ErrorNote } from '../ui'

type Digest = { text: string; generatedAt: string; aiAvailable: boolean }
type AiResult = { text: string; generatedAt: string; model: string; cached: boolean }

/** Текст сводки: строки без точки в конце и без цифры в начале — заголовки разделов. */
function DigestText({ text }: { text: string }) {
  return (
    <div className="space-y-1 rounded-xl bg-brand-50 p-5 text-[15px] leading-relaxed text-slate-900">
      {text.split('\n').map((line, i) => {
        if (!line) return <div key={i} className="h-2" />
        const heading = !/[.:;!?]$/.test(line) && !/^\d/.test(line) && line.length < 48
        return heading ? (
          <div key={i} className="pt-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
            {line}
          </div>
        ) : (
          <div key={i}>{line}</div>
        )
      })}
    </div>
  )
}

/**
 * «Сводка»: бесплатный текст за период, который пишет сама программа. Загружается сразу.
 * Если на сервере подключён искусственный интеллект, ниже есть кнопка платной версии — она не запускается сама.
 */
export function AiSummary({ period }: { period: Period }) {
  const { t, tErr, lang } = useI18n()
  const [digest, setDigest] = useState<Digest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [ai, setAi] = useState<AiResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setDigest(null)
    setAi(null)
    setAiError(null)
    api<Digest>(`/reports/digest?from=${period.from}&to=${period.to}&lang=${lang}`)
      .then((d) => {
        if (stale) return
        setDigest(d)
        setError(null)
      })
      .catch((err) => !stale && setError(tErr(err instanceof ApiError ? err.code : 'internal')))
    return () => {
      stale = true
    }
  }, [period, lang, tErr])

  async function copy() {
    if (!digest) return
    try {
      await navigator.clipboard.writeText(digest.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* буфер обмена недоступен — текст можно выделить вручную */
    }
  }

  async function makeAi(fresh: boolean) {
    setAiBusy(true)
    setAiError(null)
    try {
      setAi(await api<AiResult>('/reports/ai-summary', { method: 'POST', body: { from: period.from, to: period.to, lang, fresh } }))
    } catch (err) {
      setAiError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{t('dgTitle')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('dgHint')}</p>
          </div>
          <button className="btn btn-ghost" disabled={!digest} onClick={() => void copy()}>
            {copied ? `✓ ${t('dgCopied')}` : t('dgCopy')}
          </button>
        </div>
        <ErrorNote text={error} />
        {!digest && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
        {digest && <DigestText text={digest.text} />}
      </section>

      {digest?.aiAvailable && (
        <section className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto font-semibold">{t('aiExtra')}</h2>
            {ai && (
              <span className="text-sm text-slate-500">
                {t('aiMade')}: {dateTime(ai.generatedAt)}
                {ai.cached ? ` · ${t('aiFromCache')}` : ''}
              </span>
            )}
            <button className="btn btn-ghost" disabled={aiBusy} onClick={() => void makeAi(!!ai)}>
              {aiBusy ? t('aiWorking') : ai ? t('aiAgain') : t('aiMake')}
            </button>
          </div>
          <ErrorNote text={aiError} />
          {ai && (
            <>
              <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-5 text-[15px] leading-relaxed text-slate-900">{ai.text}</div>
              <p className="text-xs text-slate-500">{t('aiDisclaimer')}</p>
            </>
          )}
        </section>
      )}
    </div>
  )
}
