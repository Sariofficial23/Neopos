import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { API_BASE, money } from '../api'
import { LangSwitch, useI18n, type Lang } from '../i18n'
import { Badge, ErrorNote, Field, Modal, Switch, Toggle } from '../ui'
import { TelegramCard } from './TelegramCard'

/** Сайт для клиентов — там кнопка «Скачать кассу». */
const SITE_URL = 'https://neopos-sepia.vercel.app'
const TOKEN_KEY = 'neopos.admin.token'

// ───────────── Тексты админ-панели ─────────────

const T = {
  title: { uz: 'NeoPos — administrator', ru: 'NeoPos — администратор' },
  signIn: { uz: 'Kirish', ru: 'Войти' },
  signOut: { uz: 'Chiqish', ru: 'Выйти' },
  login: { uz: 'Login', ru: 'Логин' },
  password: { uz: 'Parol', ru: 'Пароль' },
  brands: { uz: 'Brendlar', ru: 'Бренды' },
  newBrand: { uz: 'Yangi brend', ru: 'Новый бренд' },
  venue: { uz: 'Brend (muassasa) nomi', ru: 'Название бренда (заведения)' },
  ownerName: { uz: 'Egasining ismi', ru: 'Имя владельца' },
  ownerLogin: { uz: 'Egasi uchun login', ru: 'Логин владельца' },
  loginHint: { uz: 'Lotin harflari va raqamlar, 3–32 belgi', ru: 'Латинские буквы и цифры, 3–32 символа' },
  passwordHint: { uz: 'Kamida 8 ta belgi', ru: 'Не короче 8 символов' },
  generate: { uz: 'Yaratish', ru: 'Сгенерировать' },
  language: { uz: 'Til', ru: 'Язык' },
  note: { uz: 'Izoh', ru: 'Заметка' },
  noteHint: { uz: 'Telefon, shartnoma, tarif — faqat siz ko‘rasiz', ru: 'Телефон, договор, тариф — видите только вы' },
  create: { uz: 'Brend yaratish', ru: 'Создать бренд' },
  cancel: { uz: 'Bekor qilish', ru: 'Отмена' },
  save: { uz: 'Saqlash', ru: 'Сохранить' },
  search: { uz: 'Qidirish: nom, login, izoh', ru: 'Поиск: название, логин, заметка' },
  owner: { uz: 'Egasi', ru: 'Владелец' },
  created: { uz: 'Yaratilgan', ru: 'Создан' },
  staff: { uz: 'Xodimlar', ru: 'Сотрудники' },
  kassas: { uz: 'Kassalar', ru: 'Кассы' },
  revenue30: { uz: 'Tushum, 30 kun', ru: 'Выручка за 30 дней' },
  lastSale: { uz: 'Oxirgi savdo', ru: 'Последняя продажа' },
  active: { uz: 'Faol', ru: 'Работает' },
  blocked: { uz: 'Bloklangan', ru: 'Заблокирован' },
  access: { uz: 'Kirish ruxsati', ru: 'Доступ' },
  edit: { uz: 'Tahrirlash', ru: 'Изменить' },
  resetPassword: { uz: 'Yangi parol', ru: 'Новый пароль' },
  resetTitle: { uz: 'Egasiga yangi parol', ru: 'Новый пароль владельцу' },
  resetHint: { uz: 'Eski parol ishlamay qoladi.', ru: 'Старый пароль перестанет работать.' },
  confirmBlock: {
    uz: 'Brend bloklansinmi? Uning paneli va kassalari darhol ishlamay qoladi. Ma’lumotlar saqlanadi.',
    ru: 'Заблокировать бренд? Его панель и кассы сразу перестанут работать. Данные сохранятся.',
  },
  credsTitle: { uz: 'Kirish ma’lumotlari', ru: 'Данные для входа' },
  credsHint: {
    uz: 'Nusxa oling va brend egasiga yuboring. Parol boshqa ko‘rsatilmaydi.',
    ru: 'Скопируйте и отправьте владельцу бренда. Пароль больше не будет показан.',
  },
  copy: { uz: 'Nusxa olish', ru: 'Скопировать' },
  copied: { uz: 'Nusxa olindi', ru: 'Скопировано' },
  done: { uz: 'Tayyor', ru: 'Готово' },
  panel: { uz: 'Panel', ru: 'Панель' },
  downloadKassa: { uz: 'Kassani yuklab olish', ru: 'Скачать кассу' },
  registration: { uz: 'Ochiq ro‘yxatdan o‘tish', ru: 'Открытая регистрация' },
  registrationHint: {
    uz: 'Yoqilgan bo‘lsa, istalgan odam panelda o‘zi brend ochishi mumkin. O‘chirilsa — brendlarni faqat siz yaratasiz.',
    ru: 'Если включено, любой может сам создать бренд в панели. Если выключено — бренды создаёте только вы.',
  },
  registrationLocked: { uz: 'Serverda ALLOW_REGISTER=false bilan yopilgan', ru: 'Закрыто на сервере переменной ALLOW_REGISTER=false' },
  total: { uz: 'Jami', ru: 'Всего' },
  empty: { uz: 'Hozircha brendlar yo‘q', ru: 'Брендов пока нет' },
  loading: { uz: 'Yuklanmoqda…', ru: 'Загрузка…' },
  never: { uz: 'hali yo‘q', ru: 'ещё не было' },
  'err.bad_credentials': { uz: 'Login yoki parol noto‘g‘ri', ru: 'Неверный логин или пароль' },
  'err.too_many_attempts': { uz: 'Urinishlar ko‘p. Bir daqiqa kuting.', ru: 'Слишком много попыток. Подождите минуту.' },
  'err.login_taken': { uz: 'Bu login band', ru: 'Этот логин уже занят' },
  'err.validation': { uz: 'Maydonlarni tekshiring', ru: 'Проверьте заполнение полей' },
  'err.network': { uz: 'Server bilan aloqa yo‘q', ru: 'Нет связи с сервером' },
  'err.internal': { uz: 'Serverda xatolik', ru: 'Ошибка на сервере' },
} as const
type K = keyof typeof T

function useT() {
  const { lang } = useI18n()
  return useMemo(() => {
    const t = (k: K) => T[k][lang]
    const tErr = (code: string) => {
      const k = `err.${code}` as K
      return k in T ? T[k][lang] : T['err.internal'][lang]
    }
    return { t, tErr, lang }
  }, [lang])
}

// ───────────── Запросы ─────────────

class AdminError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
const setToken = (v: string | null) => {
  try {
    if (v) localStorage.setItem(TOKEN_KEY, v)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* хранилище недоступно */
  }
}

export async function adminApi<R>(path: string, init: { method?: string; body?: unknown } = {}): Promise<R> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new AdminError(0, 'network')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new AdminError(res.status, data.error ?? 'internal')
  }
  return res.json() as Promise<R>
}

type Brand = {
  id: string
  name: string
  note: string | null
  blocked: boolean
  createdAt: string
  owner: { name: string; login: string | null } | null
  staff: number
  terminals: number
  revenue30: number
  lastSale: string | null
}

type Me = { login: string; allowRegister: boolean; registerLocked: boolean }

/** Пароль без похожих символов (0/O, 1/l), чтобы его можно было продиктовать. */
function makePassword() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => abc[b % abc.length]).join('')
}

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric' }) : null

// ───────────── Экран ─────────────

export function AdminApp() {
  const { t } = useT()
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(() => getToken() !== null)

  const load = useCallback(async () => {
    try {
      setMe(await adminApi<Me>('/admin/me'))
    } catch {
      setToken(null)
      setMe(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    document.title = 'NeoPos — admin'
    if (getToken()) void load()
  }, [load])

  if (checking) return <div className="p-8 text-sm text-slate-500">{t('loading')}</div>
  if (!me)
    return (
      <AdminLogin
        onToken={async (tk) => {
          setToken(tk)
          setChecking(true)
          await load()
        }}
      />
    )
  return (
    <AdminHome
      me={me}
      setMe={setMe}
      onSignOut={() => {
        setToken(null)
        setMe(null)
      }}
    />
  )
}

function AdminLogin({ onToken }: { onToken: (token: string) => Promise<void> }) {
  const { t, tErr } = useT()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { token } = await adminApi<{ token: string }>('/admin/login', { method: 'POST', body: form })
      await onToken(token)
    } catch (err) {
      setError(tErr(err instanceof AdminError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="text-2xl font-bold tracking-tight text-white">
            Neo<span className="text-brand-500">Pos</span> <span className="text-base font-medium text-slate-400">admin</span>
          </div>
          <LangSwitch />
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <Field label={t('login')}>
            <input
              className="input"
              required
              autoComplete="username"
              autoCapitalize="none"
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
            />
          </Field>
          <Field label={t('password')}>
            <input
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <ErrorNote text={error} />
          <button className="btn btn-primary w-full" disabled={busy}>
            {t('signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}

type Creds = { venue: string; login: string; password: string }

function AdminHome({ me, setMe, onSignOut }: { me: Me; setMe: (m: Me) => void; onSignOut: () => void }) {
  const { t, tErr } = useT()
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Brand | null>(null)
  const [resetting, setResetting] = useState<Brand | null>(null)
  const [creds, setCreds] = useState<Creds | null>(null)

  const errText = useCallback((err: unknown) => tErr(err instanceof AdminError ? err.code : 'internal'), [tErr])

  const load = useCallback(async () => {
    try {
      setBrands(await adminApi<Brand[]>('/admin/tenants'))
      setError(null)
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) onSignOut()
      else setError(errText(err))
    }
  }, [errText, onSignOut])

  useEffect(() => {
    void load()
  }, [load])

  async function setBlocked(b: Brand, blocked: boolean) {
    if (blocked && !window.confirm(`${b.name}\n\n${t('confirmBlock')}`)) return
    setBrands((list) => list?.map((x) => (x.id === b.id ? { ...x, blocked } : x)) ?? null)
    try {
      await adminApi(`/admin/tenants/${b.id}`, { method: 'PATCH', body: { blocked } })
    } catch (err) {
      setError(errText(err))
      await load()
    }
  }

  async function setRegistration(allowRegister: boolean) {
    try {
      const res = await adminApi<{ allowRegister: boolean }>('/admin/settings', { method: 'PATCH', body: { allowRegister } })
      setMe({ ...me, allowRegister: res.allowRegister })
    } catch (err) {
      setError(errText(err))
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return brands ?? []
    return (brands ?? []).filter((b) =>
      [b.name, b.owner?.login, b.owner?.name, b.note].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [brands, query])

  const activeCount = brands?.filter((b) => !b.blocked).length ?? 0

  return (
    <div className="min-h-screen">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto text-lg font-bold">
            Neo<span className="text-brand-500">Pos</span> <span className="text-sm font-medium text-slate-400">admin</span>
          </div>
          <span className="text-sm text-slate-400">{me.login}</span>
          <LangSwitch />
          <button type="button" onClick={onSignOut} className="cursor-pointer text-sm text-slate-300 hover:text-white">
            {t('signOut')}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            {t('brands')}{' '}
            {brands && (
              <span className="text-base font-normal text-slate-500">
                · {t('active')}: {activeCount} / {t('total')}: {brands.length}
              </span>
            )}
          </h1>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + {t('newBrand')}
          </button>
        </div>

        <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0 max-w-xl">
            <div className="font-medium">{t('registration')}</div>
            <div className="text-sm text-slate-500">{me.registerLocked ? t('registrationLocked') : t('registrationHint')}</div>
          </div>
          <Switch
            label={t('registration')}
            checked={me.allowRegister}
            disabled={me.registerLocked}
            onChange={(v) => void setRegistration(v)}
          />
        </section>

        <TelegramCard />

        <ErrorNote text={error} />

        <input
          className="input max-w-sm"
          type="search"
          placeholder={t('search')}
          aria-label={t('search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {!brands && !error && <div className="text-sm text-slate-500">{t('loading')}</div>}
        {brands && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('brands')}</th>
                  <th className="px-4 py-3 font-medium">{t('owner')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('staff')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('kassas')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('revenue30')}</th>
                  <th className="px-4 py-3 font-medium">{t('lastSale')}</th>
                  <th className="px-4 py-3 text-center font-medium">{t('access')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((b) => (
                  <tr key={b.id} className={b.blocked ? 'bg-red-50/60' : ''}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-slate-500">
                        {t('created')}: {date(b.createdAt)}
                        {b.note ? ` · ${b.note}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{b.owner?.name ?? '—'}</div>
                      <div className="font-mono text-xs text-slate-500">{b.owner?.login ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.staff}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.terminals}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{money(b.revenue30)}</td>
                    <td className="px-4 py-3 text-slate-600">{date(b.lastSale) ?? <span className="text-slate-400">{t('never')}</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <Switch label={`${t('access')}: ${b.name}`} checked={!b.blocked} onChange={(v) => void setBlocked(b, !v)} />
                        <Badge tone={b.blocked ? 'slate' : 'green'}>{b.blocked ? t('blocked') : t('active')}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button className="cursor-pointer text-sm font-medium text-brand-600 hover:underline" onClick={() => setEditing(b)}>
                          {t('edit')}
                        </button>
                        <button className="cursor-pointer text-sm font-medium text-brand-600 hover:underline" onClick={() => setResetting(b)}>
                          {t('resetPassword')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      {t('empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {creating && (
        <CreateBrand
          onClose={() => setCreating(false)}
          onCreated={async (c) => {
            setCreating(false)
            setCreds(c)
            await load()
          }}
        />
      )}
      {editing && (
        <EditBrand
          brand={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
      {resetting && (
        <ResetPassword
          brand={resetting}
          onClose={() => setResetting(null)}
          onDone={async (c) => {
            setResetting(null)
            setCreds(c)
            await load()
          }}
        />
      )}
      {creds && <Credentials creds={creds} onClose={() => setCreds(null)} />}
    </div>
  )
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT()
  return (
    <Field label={t('password')} hint={t('passwordHint')}>
      <div className="flex gap-2">
        <input
          className="input font-mono"
          required
          minLength={8}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn-ghost shrink-0" onClick={() => onChange(makePassword())}>
          🎲 {t('generate')}
        </button>
      </div>
    </Field>
  )
}

function CreateBrand({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Creds) => Promise<void> }) {
  const { t, tErr, lang } = useT()
  const [form, setForm] = useState({ venue: '', name: '', login: '', password: makePassword(), lang: lang as Lang, note: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminApi('/admin/tenants', { method: 'POST', body: { ...form, note: form.note || null } })
      await onCreated({ venue: form.venue, login: form.login.trim().toLowerCase(), password: form.password })
    } catch (err) {
      setError(tErr(err instanceof AdminError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal wide title={t('newBrand')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('venue')}>
          <input className="input" required minLength={2} maxLength={80} autoFocus value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ownerName')}>
            <input className="input" required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('language')}>
            <select className="input" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as Lang })}>
              <option value="uz">O‘zbekcha</option>
              <option value="ru">Русский</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ownerLogin')} hint={t('loginHint')}>
            <input
              className="input font-mono"
              required
              autoCapitalize="none"
              autoComplete="off"
              pattern="[A-Za-z0-9._\-]{3,32}"
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
            />
          </Field>
          <PasswordField value={form.password} onChange={(password) => setForm({ ...form, password })} />
        </div>
        <Field label={t('note')} hint={t('noteHint')}>
          <input className="input" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <ErrorNote text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {t('create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditBrand({ brand, onClose, onSaved }: { brand: Brand; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, tErr } = useT()
  const [name, setName] = useState(brand.name)
  const [note, setNote] = useState(brand.note ?? '')
  const [blocked, setBlocked] = useState(brand.blocked)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (blocked && !brand.blocked && !window.confirm(`${brand.name}\n\n${t('confirmBlock')}`)) return
    setBusy(true)
    setError(null)
    try {
      await adminApi(`/admin/tenants/${brand.id}`, { method: 'PATCH', body: { name, note: note || null, blocked } })
      await onSaved()
    } catch (err) {
      setError(tErr(err instanceof AdminError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={brand.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('venue')}>
          <input className="input" required minLength={2} maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('note')} hint={t('noteHint')}>
          <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Toggle label={t('active')} checked={!blocked} onChange={(v) => setBlocked(!v)} />
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

function ResetPassword({ brand, onClose, onDone }: { brand: Brand; onClose: () => void; onDone: (c: Creds) => Promise<void> }) {
  const { t, tErr } = useT()
  const [password, setPassword] = useState(makePassword)
  const [login, setLogin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needLogin = !brand.owner?.login

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await adminApi<{ login: string }>(`/admin/tenants/${brand.id}/reset-password`, {
        method: 'POST',
        body: { password, login: needLogin ? login : null },
      })
      await onDone({ venue: brand.name, login: res.login, password })
    } catch (err) {
      setError(tErr(err instanceof AdminError ? err.code : 'internal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('resetTitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <div className="font-medium">{brand.name}</div>
          <div className="text-slate-600">
            {brand.owner?.name ?? '—'} · <span className="font-mono">{brand.owner?.login ?? '—'}</span>
          </div>
        </div>
        {needLogin && (
          <Field label={t('ownerLogin')} hint={t('loginHint')}>
            <input
              className="input font-mono"
              required
              autoCapitalize="none"
              pattern="[A-Za-z0-9._\-]{3,32}"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </Field>
        )}
        <PasswordField value={password} onChange={setPassword} />
        <p className="text-sm text-slate-500">{t('resetHint')}</p>
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

/** Готовый текст для владельца бренда: адреса, логин и пароль. */
function Credentials({ creds, onClose }: { creds: Creds; onClose: () => void }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const text = [
    `NeoPos — ${creds.venue}`,
    `${t('panel')}: ${window.location.origin}`,
    `${t('login')}: ${creds.login}`,
    `${t('password')}: ${creds.password}`,
    `${t('downloadKassa')}: ${SITE_URL}`,
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      /* буфер обмена недоступен — текст можно выделить вручную */
    }
  }

  return (
    <Modal title={t('credsTitle')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('credsHint')}</p>
        <pre className="select-all whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm">{text}</pre>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
            {copied ? `✓ ${t('copied')}` : t('copy')}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('done')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
