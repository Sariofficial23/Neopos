import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type PermissionList, type Role } from '../api'
import { useI18n, type Key } from '../i18n'
import { useSession } from '../session'
import { Badge, ErrorNote, Field, Modal, Toggle } from '../ui'

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

      <div className="grid gap-3 sm:grid-cols-2">
        {roles?.map((r) => (
          <div key={r.id} className="card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-slate-500">
                  {t('staffCount')}: {r.staffCount ?? 0}
                </div>
              </div>
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
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.isOwner ? (
                <Badge tone="brand">{t('ownerAll')}</Badge>
              ) : (
                <>
                  {r.panelAccess && <Badge tone="green">{t('panelAccess')}</Badge>}
                  {r.terminalAccess && <Badge tone="green">{t('terminalAccess')}</Badge>}
                  {!r.panelAccess && !r.terminalAccess && <Badge tone="slate">—</Badge>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

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
