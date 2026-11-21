const DEVICE_KEY = 'neopos.device'
const SESSION_KEY = 'neopos.pos.session'

const read = (store: Storage, key: string) => {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}
const write = (store: Storage, key: string, value: string | null) => {
  try {
    if (value) store.setItem(key, value)
    else store.removeItem(key)
  } catch {
    /* хранилище недоступно — работаем до перезагрузки страницы */
  }
}

/** Токен устройства живёт долго; сессия сотрудника — только пока открыта вкладка. */
export const device = {
  get: () => read(localStorage, DEVICE_KEY),
  set: (v: string | null) => write(localStorage, DEVICE_KEY, v),
}
export const session = {
  get: () => read(sessionStorage, SESSION_KEY),
  set: (v: string | null) => write(sessionStorage, SESSION_KEY, v),
}

/** В разработке запросы идут через прокси Vite; в боевой сборке адрес сервера задаёт VITE_API_URL. */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

let onSessionLost: () => void = () => {}
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; as?: 'user' | 'device' | 'none' } = {},
): Promise<T> {
  const as = init.as ?? 'user'
  const token = as === 'user' ? session.get() : as === 'device' ? device.get() : null
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
    if (res.status === 401 && as === 'user') onSessionLost()
    throw new ApiError(res.status, data.error ?? 'internal')
  }
  return res.json() as Promise<T>
}

export type L10n = { uz: string; ru: string }
export type Lang = 'uz' | 'ru'

export type Boot = {
  venue: string
  print: {
    address: string
    phone: string
    header: string
    footer: string
    showWaiter: boolean
    showGuests: boolean
    showTime: boolean
    kitchen: boolean
    receipt: boolean
  }
  departments: { id: string; name: string }[]
  user: { userId: string; name: string; lang: Lang; role: { name: string; permissions: string[] } }
  shift: Shift | null
  categories: { id: string; name: L10n; color: string | null }[]
  products: { id: string; name: L10n; price: number; categoryId: string | null; favorite: boolean; stopped: boolean }[]
  halls: { id: string; name: string; tables: { id: string; name: string; seats: number }[] }[]
  saleTypes: { id: string; kind: string; name: L10n; serviceBp: number }[]
  paymentMethods: { id: string; kind: string; name: L10n }[]
  reasons: { id: string; kind: string; name: L10n }[]
}

export type Shift = { id: string; number: number; openedAt: string; openingCash: number }

export type ShiftSummary = {
  receipts: number
  revenue: number
  openReceipts: number
  expectedCash: number
  byMethod: { methodId: string; kind: string; name: L10n; amount: number }[]
}

export type ReceiptItem = {
  id: string
  productId: string | null
  departmentId: string | null
  name: L10n
  price: number
  qty: number
  total: number
  comment: string | null
  sent: boolean
  voided: boolean
}

export type Receipt = {
  id: string
  number: number
  status: string
  tableId: string | null
  tableName: string | null
  saleTypeId: string | null
  waiterId: string | null
  waiterName: string | null
  guests: number
  comment: string | null
  subtotal: number
  discountKind: 'percent' | 'amount' | null
  discountValue: number
  discountAmount: number
  serviceBp: number
  serviceAmount: number
  total: number
  openedAt: string
  closedAt: string | null
  billPrinted: boolean
  payments: { name: L10n; kind: string; amount: number }[]
  items: ReceiptItem[]
}

export type OpenReceipt = {
  id: string
  number: number
  tableId: string | null
  tableName: string | null
  saleTypeId: string | null
  waiterId: string | null
  waiterName: string | null
  total: number
  billPrinted: boolean
  openedAt: string
}

export const money = (n: number) => n.toLocaleString('ru-RU').replace(/,/g, ' ')

/** Количество хранится в тысячных: 1000 → «1», 350 → «0,35». */
export const qtyText = (q: number) => (q % 1000 === 0 ? String(q / 1000) : (q / 1000).toFixed(3).replace(/0+$/, '').replace('.', ','))
