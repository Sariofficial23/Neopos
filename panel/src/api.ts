const TOKEN_KEY = 'neopos.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* хранилище недоступно */
  }
}

/** В разработке запросы идут через прокси Vite; в боевой сборке адрес сервера задаёт VITE_API_URL. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
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
    throw new ApiError(0, 'network')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    // 401 на защищённом запросе значит, что сессия закончилась.
    if (res.status === 401 && token && !path.startsWith('/auth/login')) onUnauthorized()
    throw new ApiError(res.status, data.error ?? 'internal')
  }
  return res.json() as Promise<T>
}

export type Role = {
  id: string
  name: string
  isOwner: boolean
  panelAccess: boolean
  terminalAccess: boolean
  permissions: string[]
  staffCount?: number
}

export type Staff = {
  id: string
  name: string
  phone: string | null
  login: string | null
  lang: 'uz' | 'ru'
  active: boolean
  roleId: string
  roleName: string
  isOwner: boolean
  hasPin: boolean
}

export type Me = {
  user: {
    userId: string
    name: string
    lang: 'uz' | 'ru'
    role: Role
  }
  tenant: { id: string; name: string; currency: string }
}

export type PermissionList = { panel: string[]; terminal: string[] }

export type L10n = { uz: string; ru: string }

export type Department = { id: string; name: string; printer: string | null }

export type Category = {
  id: string
  name: L10n
  color: string | null
  sort: number
  active: boolean
  productCount: number
}

export type Product = {
  id: string
  name: L10n
  categoryId: string | null
  departmentId: string | null
  price: number
  cost: number
  barcode: string | null
  unit: 'pcs' | 'kg' | 'l'
  byWeight: boolean
  favorite: boolean
  stopped: boolean
  active: boolean
  sort: number
}

export type Table = { id: string; hallId: string; name: string; seats: number; serviceBp: number | null }
export type Hall = { id: string; name: string; sort: number; tables: Table[] }

/** Сумма в сумах с пробелами между разрядами: 38 000 */
export const money = (n: number) => n.toLocaleString('ru-RU').replace(/,/g, ' ')
