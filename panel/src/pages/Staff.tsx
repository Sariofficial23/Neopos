import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type Role, type Staff } from '../api'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { Badge, ErrorNote, Field, Modal, Toggle } from '../ui'

type Draft = {
  id?: string
  name: string
  roleId: string
  phone: string
  login: string
  password: string
  pin: string
  lang: 'uz' | 'ru'
  active: boolean
  hadPin: boolean
  hadLogin: boolean
}

export function StaffPage() {
  const { t, tErr } = useI18n()
  const { can, me } = useSession()
  const canEdit = can('staff.edit')
  const [staff, setStaff] = useState<Staff[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api<Staff[]>('/staff'), api<Role[]>('/roles')])
      setStaff(s)
      setRoles(r)
      setPageError(null)
    } catch (err) {
      setPageError(tErr(err instanceof ApiError ? err.code : 'internal'))
    }
  }, [tErr])

  useEffect(() => {
    void load()
  }, [load])

  // Назначать должность владельца может только владелец.
  const assignableRoles = roles.filter((r) => !r.isOwner || me?.user.role.isOwner)

  function openNew() {
    const first = roles.find((r) => !r.isOwner) ?? roles[0]
    setError(null)
    setDraft({
      name: '',
      roleId: first?.id ?? '',
      phone: '',
      login: '',
      password: '',
      pin: '',
      lang: 'uz',
      active: true,
      hadPin: false,
      hadLogin: false,
    })
  }

  function openEdit(s: Staff) {
    setError(null)
    setDraft({
      id: s.id,
      name: s.name,
      roleId: s.roleId,
      phone: s.phone ?? '',
      login: s.login ?? '',
      password: '',
      pin: '',
      lang: s.lang,
      active: s.active,
      hadPin: s.hasPin,
      hadLogin: !!s.login,
    })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: draft.name,
        roleId: draft.roleId,
        phone: draft.phone || null,
        login: draft.login || null,
        password: draft.password || null,
        pin: draft.pin || null,
        lang: draft.lang,
        active: draft.active,
      }
      if (draft.id) await api(`/staff/${draft.id}`, { method: 'PATCH', body })
      else await api('/staff', { method: 'POST', body })
      setDraft(null)
      await load()
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!draft?.id || !window.confirm(t('confirmDelete'))) return
    setBusy(true)
    try {
      await api(`/staff/${draft.id}`, { method: 'DELETE' })
      setDraft(null)
      await load()
    } catch (err) {
      setError(tErr(err instanceof ApiError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  const up = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('staffTitle')}</h1>
        {canEdit && (
          <button className="btn btn-primary" onClick={openNew}>
            + {t('addStaff')}
          </button>
        )}
      </div>
      <ErrorNote text={pageError} />

      {!staff && !pageError && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {staff && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('name')}</th>
                <th className="px-4 py-3 font-medium">{t('role')}</th>
                <th className="px-4 py-3 font-medium">{t('phone')}</th>
                <th className="px-4 py-3 font-medium">{t('login')}</th>
                <th className="px-4 py-3 font-medium">{t('pin')}</th>
                <th className="px-4 py-3 font-medium">{t('status')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    {s.isOwner ? <Badge tone="brand">{s.roleName}</Badge> : s.roleName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.login ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.hasPin ? t('pinSet') : '—'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={s.active ? 'green' : 'slate'}>{s.active ? t('active') : t('inactive')}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (!s.isOwner || me?.user.role.isOwner) && (
                      <button
                        className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
                        onClick={() => openEdit(s)}
                      >
                        {t('edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal title={draft.id ? t('edit') : t('addStaff')} onClose={() => setDraft(null)}>
          <form onSubmit={save} className="space-y-4">
            <Field label={t('name')}>
              <input
                className="input"
                required
                minLength={2}
                autoFocus
                value={draft.name}
                onChange={(e) => up('name', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('role')}>
                <select className="input" value={draft.roleId} onChange={(e) => up('roleId', e.target.value)}>
                  {assignableRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('language')}>
                <select
                  className="input"
                  value={draft.lang}
                  onChange={(e) => up('lang', e.target.value as 'uz' | 'ru')}
                >
                  <option value="uz">O‘zbekcha</option>
                  <option value="ru">Русский</option>
                </select>
              </Field>
            </div>
            <Field label={t('phone')}>
              <input
                className="input"
                inputMode="tel"
                placeholder="+998"
                value={draft.phone}
                onChange={(e) => up('phone', e.target.value)}
              />
            </Field>
            <Field label={t('pin')} hint={draft.hadPin ? t('pinKeep') : t('pinHint')}>
              <input
                className="input"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                autoComplete="off"
                placeholder={draft.hadPin ? '••••' : ''}
                value={draft.pin}
                onChange={(e) => up('pin', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('panelLogin')} hint={t('panelLoginHint')}>
                <input
                  className="input"
                  autoCapitalize="none"
                  autoComplete="off"
                  pattern="[A-Za-z0-9._\-]{3,32}"
                  value={draft.login}
                  onChange={(e) => up('login', e.target.value)}
                />
              </Field>
              <Field label={t('password')} hint={draft.hadLogin ? t('pinKeep') : t('passwordHint')}>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required={!!draft.login && !draft.hadLogin}
                  disabled={!draft.login}
                  value={draft.password}
                  onChange={(e) => up('password', e.target.value)}
                />
              </Field>
            </div>
            <Toggle checked={draft.active} onChange={(v) => up('active', v)} label={t('active')} />
            <ErrorNote text={error} />
            <div className="flex items-center justify-between gap-3 pt-1">
              {draft.id ? (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>
                  {t('delete')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" disabled={busy}>
                  {t('save')}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
