import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { dateTime } from '../period'
import { ErrorNote, Field, Modal, Switch } from '../ui'

type Terminal = { id: string; number: number; name: string; password: string | null; active: boolean; online: boolean; lastSeenAt: string | null }
type Data = { brand: string | null; terminals: Terminal[] }

const W = {
  title: { uz: 'Terminallar', ru: 'Терминалы' },
  create: { uz: 'Yaratish', ru: 'Создать' },
  hint: {
    uz: 'Kassada ikki maydon to‘ldiriladi: brend va terminal paroli.',
    ru: 'На кассе вводят два поля: бренд и пароль терминала.',
  },
  brand: { uz: 'Brend', ru: 'Бренд' },
  name: { uz: 'Nomi', ru: 'Наименование' },
  password: { uz: 'Parol', ru: 'Пароль' },
  passwordHint: { uz: '4–16 ta raqam yoki lotin harfi, masalan 11111', ru: '4–16 цифр или латинских букв, например 11111' },
  status: { uz: 'Holati', ru: 'Статус' },
  online: { uz: 'Onlayn', ru: 'Онлайн' },
  lastSeen: { uz: 'Oxirgi aloqa', ru: 'Был на связи' },
  noPassword: { uz: 'parol qo‘yilmagan', ru: 'пароль не задан' },
  empty: { uz: 'Terminallar hali yo‘q. Birinchisini yarating.', ru: 'Терминалов пока нет. Создайте первый.' },
  newTitle: { uz: 'Yangi terminal', ru: 'Новый терминал' },
  editTitle: { uz: 'Terminalni o‘zgartirish', ru: 'Изменить терминал' },
  active: { uz: 'Yoqilgan', ru: 'Включён' },
  confirmDelete: {
    uz: 'Terminal o‘chirilsinmi? Shu parol bilan ulangan kassa ishlashdan to‘xtaydi.',
    ru: 'Удалить терминал? Касса, подключённая с этим паролем, перестанет работать.',
  },
  'err.terminal_password_taken': { uz: 'Bu parol boshqa terminalda bor', ru: 'Этот пароль уже у другого терминала' },
  'err.bad_terminal_password': { uz: 'Parol: 4–16 ta raqam yoki lotin harfi', ru: 'Пароль: 4–16 цифр или латинских букв' },
} as const

/** «Терминалы», как в Clopos: список касс с паролями, статусом и признаком «онлайн». */
export function TerminalsPage() {
  const { t, tErr, lang } = useI18n()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Terminal | 'new' | null>(null)

  const errText = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'internal'
      const key = `err.${code}` as keyof typeof W
      return key in W ? W[key][lang] : tErr(code)
    },
    [tErr, lang],
  )

  const load = useCallback(async () => {
    try {
      setData(await api<Data>('/terminals'))
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [errText])

  useEffect(() => {
    void load()
    // «Онлайн» обновляется само, пока страница открыта.
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  async function setActive(term: Terminal, active: boolean) {
    try {
      await api(`/terminals/${term.id}`, { method: 'PATCH', body: { name: term.name, password: term.password ?? '', active } })
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  async function remove(term: Terminal) {
    if (!window.confirm(`${term.name}\n\n${W.confirmDelete[lang]}`)) return
    try {
      await api(`/terminals/${term.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(errText(err))
    }
  }

  const dot = (on: boolean) => (
    <span className={`inline-grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{on ? '✓' : '×'}</span>
  )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {W.title[lang]} {data && <span className="text-base font-normal text-slate-500">{data.terminals.length}</span>}
        </h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + {W.create[lang]}
        </button>
      </div>

      {data?.brand && (
        <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
          <span>
            {W.brand[lang]}: <b className="font-mono text-base">{data.brand}</b>
          </span>
          <span className="text-slate-500">{W.hint[lang]}</span>
        </div>
      )}

      <ErrorNote text={error} />
      {!data && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">{W.name[lang]}</th>
                <th className="px-4 py-3">{W.password[lang]}</th>
                <th className="px-4 py-3 text-center">{W.status[lang]}</th>
                <th className="px-4 py-3 text-center">{W.online[lang]}</th>
                <th className="px-4 py-3">{W.lastSeen[lang]}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.terminals.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {W.empty[lang]}
                  </td>
                </tr>
              )}
              {data.terminals.map((term) => (
                <tr key={term.id}>
                  <td className="px-4 py-3 text-brand-600">{term.number}</td>
                  <td className="px-4 py-3 font-medium">{term.name}</td>
                  <td className="px-4 py-3 font-mono">{term.password ?? <span className="font-sans text-slate-400">{W.noPassword[lang]}</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center">
                      <Switch label={W.active[lang]} checked={term.active} disabled={!term.password} onChange={(v) => void setActive(term, v)} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">{dot(term.online)}</td>
                  <td className="px-4 py-3 text-slate-600">{dateTime(term.lastSeenAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button className="cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => setEditing(term)}>
                      {t('edit')}
                    </button>
                    <button className="ml-3 cursor-pointer font-medium text-red-600 hover:underline" onClick={() => void remove(term)}>
                      {t('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TerminalForm
          terminal={editing === 'new' ? null : editing}
          suggestedName={`Terminal ${(data?.terminals.length ?? 0) + 1}`}
          errText={errText}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function TerminalForm({
  terminal,
  suggestedName,
  errText,
  onClose,
  onSaved,
}: {
  terminal: Terminal | null
  suggestedName: string
  errText: (err: unknown) => string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, lang } = useI18n()
  const [name, setName] = useState(terminal?.name ?? suggestedName)
  const [password, setPassword] = useState(terminal?.password ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { name, password, active: terminal?.active ?? true }
      await (terminal ? api(`/terminals/${terminal.id}`, { method: 'PATCH', body }) : api('/terminals', { method: 'POST', body }))
      await onSaved()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={terminal ? W.editTitle[lang] : W.newTitle[lang]} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={W.name[lang]}>
          <input className="input" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={W.password[lang]} hint={W.passwordHint[lang]}>
          <input
            className="input font-mono"
            required
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9A-Za-z]{4,16}"
            maxLength={16}
            value={password}
            onChange={(e) => setPassword(e.target.value.replace(/[^0-9A-Za-z]/g, ''))}
          />
        </Field>
        <ErrorNote text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
