import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { DOWNLOAD_URL } from '../download'
import { LangSwitch, useI18n } from '../i18n'
import { useSession } from '../session'
import { ErrorNote, Field } from '../ui'

export function Login() {
  const { t, tErr, lang } = useI18n()
  const { signIn } = useSession()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ venue: '', name: '', login: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const body =
        mode === 'login'
          ? { login: form.login, password: form.password }
          : { ...form, lang }
      const { token } = await api<{ token: string }>(`/auth/${mode}`, { method: 'POST', body })
      await signIn(token)
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold tracking-tight">
              Neo<span className="text-brand-500">Pos</span>
            </div>
            <div className="text-sm text-slate-500">{t('tagline')}</div>
          </div>
          <LangSwitch />
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="text-lg font-semibold">{mode === 'login' ? t('signIn') : t('signUp')}</h1>
          {mode === 'register' && (
            <>
              <Field label={t('venueName')}>
                <input className="input" required minLength={2} value={form.venue} onChange={set('venue')} />
              </Field>
              <Field label={t('yourName')}>
                <input className="input" required minLength={2} value={form.name} onChange={set('name')} />
              </Field>
            </>
          )}
          <Field label={t('login')} hint={mode === 'register' ? t('loginHint') : undefined}>
            <input
              className="input"
              required
              autoComplete="username"
              autoCapitalize="none"
              value={form.login}
              onChange={set('login')}
            />
          </Field>
          <Field label={t('password')} hint={mode === 'register' ? t('passwordHint') : undefined}>
            <input
              className="input"
              type="password"
              required
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          <ErrorNote text={error} />
          <button className="btn btn-primary w-full" disabled={busy}>
            {mode === 'login' ? t('signIn') : t('signUp')}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 w-full cursor-pointer text-center text-sm text-brand-600 hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? t('noAccount') : t('haveAccount')}
        </button>

        {DOWNLOAD_URL && (
          <a href={DOWNLOAD_URL} className="btn btn-ghost mt-6 w-full no-underline">
            ⬇ {t('downloadApp')}
          </a>
        )}
      </div>
    </div>
  )
}
