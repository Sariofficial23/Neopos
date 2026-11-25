import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type PermissionList, type Role } from '../api'
import { useI18n, type Key } from '../i18n'
import { useSession } from '../session'
import { Badge, ErrorNote, Field, Modal, Switch, Toggle } from '../ui'

type Draft = Omit<Role, 'id' | 'staffCount'> & { id?: string }

export function RolesPage() {
  const { t, tErr } = useI18n()
  const { can } = useSession()
  const canEdit = can('staff.edit')
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [perms, setPerms] = useState<PermissionList>({ panel: [], terminal: [] })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([api<Role[]>('/roles'), api<PermissionList>('/meta/permissions')])
      setRoles(r)
      setPerms(p)
      setPageError(null)
    } catch (err) {
      setPageError(tErr(err instanceof ApiError ? err.code : 'internal'))
    }
  }, [tErr])

  useEffect(() => {
    void load()
  }, [load])

  const fail = (err: unknown) => setError(tErr(err instanceof ApiError ? err.code : 'internal'))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: draft.name,
        panelAccess: draft.panelAccess,
        terminalAccess: draft.terminalAccess,
        permissions: draft.permissions,
      }
      if (draft.id) await api(`/roles/${draft.id}`, { method: 'PATCH', body })
      else await api('/roles', { method: 'POST', body })
      setDraft(null)
      await load()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /** Быстрые флажки в списке: доступ к панели («Админ») и к кассе («Продавец»). */
  async function quick(r: Role, patch: { panelAccess?: boolean; terminalAccess?: boolean }) {
    try {
      await api(`/roles/${r.id}`, {
        method: 'PATCH',
        body: { name: r.name, panelAccess: r.panelAccess, terminalAccess: r.terminalAccess, permissions: r.permissions, ...patch },
      })
      await load()
    } catch (err) {
      setPageError(tErr(err instanceof ApiError ? err.code : 'internal'))
    }
  }

  async function remove() {
    if (!draft?.id || !window.confirm(t('confirmDelete'))) return
    setBusy(true)
    try {
      await api(`/roles/${draft.id}`, { method: 'DELETE' })
      setDraft(null)
      await load()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const togglePerm = (p: string, on: boolean) =>
    setDraft((d) =>
      d ? { ...d, permissions: on ? [...d.permissions, p] : d.permissions.filter((x) => x !== p) } : d,
    )

  const permGroup = (title: string, list: string[], enabled: boolean) => (
    <fieldset disabled={!enabled} className={enabled ? '' : 'opacity-50'}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((p) => (
          <Toggle
            key={p}
            label={t(`perm.${p}` as Key)}
            checked={!!draft?.permissions.includes(p)}
            onChange={(v) => togglePerm(p, v)}
            disabled={!enabled}
          />
        ))}
      </div>
    </fieldset>
  )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('rolesTitle')}</h1>
        {canEdit && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setError(null)
              setDraft({ name: '', isOwner: false, panelAccess: false, terminalAccess: true, permissions: [] })
            }}
          >
            + {t('addRole')}
          </button>
        )}
      </div>
      <ErrorNote text={pageError} />
      {!roles && !pageError && <div className="text-sm text-slate-500">{t('loading')}</div>}

      {/* Как в Clopos: список должностей с флажками «Админ» и «Продавец» прямо в строке. */}
      {roles && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('roleName')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('staffCount')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('rolePerms')}</th>
                <th className="px-4 py-3 text-center font-medium" title={t('roleAdminHint')}>
                  {t('roleAdmin')}
                </th>
                <th className="px-4 py-3 text-center font-medium" title={t('roleSellerHint')}>
                  {t('roleSeller')}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium">
                    {r.name} {r.isOwner && <Badge tone="brand">{t('ownerAll')}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.staffCount ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.isOwner ? '∞' : r.permissions.length}</td>
                  <td className="px-4 py-3 text-center">
                    <Switch label={t('roleAdmin')} checked={r.isOwner || r.panelAccess} disabled={!canEdit || r.isOwner} onChange={(v) => void quick(r, { panelAccess: v })} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Switch label={t('roleSeller')} checked={r.isOwner || r.terminalAccess} disabled={!canEdit || r.isOwner} onChange={(v) => void quick(r, { terminalAccess: v })} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (
                      <button
                        className="cursor-pointer text-sm font-medium text-brand-600 hover:underline"
                        onClick={() => {
                          setError(null)
                          setDraft({ ...r })
                        }}
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
        <Modal wide title={draft.id ? t('edit') : t('addRole')} onClose={() => setDraft(null)}>
          <form onSubmit={save} className="space-y-5">
            <Field label={t('roleName')}>
              <input
                className="input"
                required
                minLength={2}
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            {draft.isOwner ? (
              <Badge tone="brand">{t('ownerAll')}</Badge>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle
                    label={t('panelAccess')}
                    checked={draft.panelAccess}
                    onChange={(v) => setDraft({ ...draft, panelAccess: v })}
                  />
                  <Toggle
                    label={t('terminalAccess')}
                    checked={draft.terminalAccess}
                    onChange={(v) => setDraft({ ...draft, terminalAccess: v })}
                  />
                </div>
                {permGroup(t('permsPanel'), perms.panel, draft.panelAccess)}
                {permGroup(t('permsTerminal'), perms.terminal, draft.terminalAccess)}
              </>
            )}
            <ErrorNote text={error} />
            <div className="flex items-center justify-between gap-3">
              {draft.id && !draft.isOwner ? (
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
