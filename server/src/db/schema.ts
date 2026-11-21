import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Соглашения: деньги — целые сумы (bigint), время — UTC, каждая таблица привязана к tenant.

const id = () => uuid('id').primaryKey().defaultRandom()
const money = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })

/** Двуязычное название: { uz, ru } */
export type L10n = { uz: string; ru: string }

// ───────────── Заведение ─────────────

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('UZS'),
  timezone: text('timezone').notNull().default('Asia/Tashkent'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  /** Бренд заблокирован администратором NeoPos (например, за неуплату) */
  blocked: boolean('blocked').notNull().default(false),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  /** Заметка администратора: телефон, договор, тариф */
  note: text('note'),
  createdAt: createdAt(),
})

export const branches = pgTable('branches', {
  id: id(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  address: text('address'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
})

// ───────────── Сотрудники и права ─────────────

export const roles = pgTable('roles', {
  id: id(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  /** Владелец: все права, нельзя удалить или ограничить */
  isOwner: boolean('is_owner').notNull().default(false),
  panelAccess: boolean('panel_access').notNull().default(false),
  terminalAccess: boolean('terminal_access').notNull().default(false),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
})

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantRef(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    name: text('name').notNull(),
    phone: text('phone'),
    /** Логин для панели; у сотрудников только с терминалом может отсутствовать */
    login: text('login'),
    passwordHash: text('password_hash'),
    /** HMAC от ПИН-кода — позволяет искать сотрудника по ПИН и держать его уникальным */
    pinHash: text('pin_hash'),
    lang: text('lang').notNull().default('uz'),
    active: boolean('active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_login_uq').on(t.login),
    uniqueIndex('users_pin_uq').on(t.tenantId, t.pinHash),
    index('users_tenant_idx').on(t.tenantId),
  ],
)

// ───────────── Меню ─────────────

export const departments = pgTable('departments', {
  id: id(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  /** Имя принтера, на который уходит заказ этого отдела */
  printer: text('printer'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const categories = pgTable(
  'categories',
  {
    id: id(),
    tenantId: tenantRef(),
    parentId: uuid('parent_id'),
    name: jsonb('name').$type<L10n>().notNull(),
    color: text('color'),
    image: text('image'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('categories_tenant_idx').on(t.tenantId)],
)

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: tenantRef(),
    categoryId: uuid('category_id').references(() => categories.id),
    departmentId: uuid('department_id').references(() => departments.id),
    /** goods — готовый товар. Позже добавятся dish (тех. карта) и др. */
    type: text('type').notNull().default('goods'),
    name: jsonb('name').$type<L10n>().notNull(),
    price: money('price'),
    /** Себестоимость единицы, вводится вручную (позже будет считаться по тех. карте) */
    cost: money('cost'),
    barcode: text('barcode'),
    image: text('image'),
    /** pcs | kg | l */
    unit: text('unit').notNull().default('pcs'),
    byWeight: boolean('by_weight').notNull().default(false),
    favorite: boolean('favorite').notNull().default(false),
    /** Стоп-лист: временно снят с продажи */
    stopped: boolean('stopped').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('products_tenant_idx').on(t.tenantId),
    uniqueIndex('products_barcode_uq')
      .on(t.tenantId, t.barcode)
      .where(sql`${t.barcode} is not null and ${t.deletedAt} is null`),
  ],
)

export const modifierGroups = pgTable('modifier_groups', {
  id: id(),
  tenantId: tenantRef(),
  name: jsonb('name').$type<L10n>().notNull(),
  minSelect: integer('min_select').notNull().default(0),
  maxSelect: integer('max_select').notNull().default(1),
  createdAt: createdAt(),
})

export const modifiers = pgTable('modifiers', {
  id: id(),
  tenantId: tenantRef(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => modifierGroups.id, { onDelete: 'cascade' }),
  name: jsonb('name').$type<L10n>().notNull(),
  price: money('price'),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
})

export const productModifierGroups = pgTable(
  'product_modifier_groups',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
)

// ───────────── Залы и столы ─────────────

export const halls = pgTable('halls', {
  id: id(),
  tenantId: tenantRef(),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const tables = pgTable('tables', {
  id: id(),
  tenantId: tenantRef(),
  hallId: uuid('hall_id')
    .notNull()
    .references(() => halls.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  seats: integer('seats').notNull().default(4),
  /** Плата за обслуживание для этого стола, сотые доли процента (1000 = 10%). null — как у способа продажи. */
  serviceBp: integer('service_bp'),
  x: integer('x').notNull().default(0),
  y: integer('y').notNull().default(0),
  w: integer('w').notNull().default(1),
  h: integer('h').notNull().default(1),
  shape: text('shape').notNull().default('rect'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// ───────────── Продажи ─────────────

export const saleTypes = pgTable('sale_types', {
  id: id(),
  tenantId: tenantRef(),
  /** hall | takeaway | delivery */
  kind: text('kind').notNull().default('hall'),
  name: jsonb('name').$type<L10n>().notNull(),
  /** Плата за обслуживание, сотые доли процента: 1000 = 10% */
  serviceBp: integer('service_bp').notNull().default(0),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
})

export const paymentMethods = pgTable('payment_methods', {
  id: id(),
  tenantId: tenantRef(),
  /** cash | card | transfer | other */
  kind: text('kind').notNull().default('cash'),
  name: jsonb('name').$type<L10n>().notNull(),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
})

export const reasons = pgTable('reasons', {
  id: id(),
  tenantId: tenantRef(),
  /** void — удаление позиции, refund — возврат, comp — угощение */
  kind: text('kind').notNull(),
  name: jsonb('name').$type<L10n>().notNull(),
  active: boolean('active').notNull().default(true),
})

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    phone: text('phone'),
    note: text('note'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('customers_tenant_idx').on(t.tenantId)],
)

export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: tenantRef(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    number: integer('number').notNull(),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    closedBy: uuid('closed_by').references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingCash: money('opening_cash'),
    /** Сколько наличных должно быть по системе на момент закрытия */
    expectedCash: bigint('expected_cash', { mode: 'number' }),
    /** Сколько насчитал кассир */
    countedCash: bigint('counted_cash', { mode: 'number' }),
  },
  (t) => [index('shifts_branch_idx').on(t.branchId, t.openedAt)],
)

export const cashMovements = pgTable('cash_movements', {
  id: id(),
  tenantId: tenantRef(),
  shiftId: uuid('shift_id')
    .notNull()
    .references(() => shifts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  /** in — внесение, out — изъятие */
  kind: text('kind').notNull(),
  amount: money('amount'),
  note: text('note'),
  createdAt: createdAt(),
})

export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    tenantId: tenantRef(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    shiftId: uuid('shift_id').references(() => shifts.id),
    /** Порядковый номер чека внутри заведения */
    number: integer('number').notNull(),
    /** open | closed | refunded | cancelled */
    status: text('status').notNull().default('open'),
    saleTypeId: uuid('sale_type_id').references(() => saleTypes.id),
    tableId: uuid('table_id').references(() => tables.id),
    waiterId: uuid('waiter_id').references(() => users.id),
    customerId: uuid('customer_id').references(() => customers.id),
    guests: integer('guests').notNull().default(1),
    comment: text('comment'),
    /** Предчек (счёт гостю) распечатан */
    billPrinted: boolean('bill_printed').notNull().default(false),
    subtotal: money('subtotal'),
    discountKind: text('discount_kind'),
    discountValue: bigint('discount_value', { mode: 'number' }).notNull().default(0),
    discountAmount: money('discount_amount'),
    serviceBp: integer('service_bp').notNull().default(0),
    serviceAmount: money('service_amount'),
    total: money('total'),
    /** Есть действия, отмеченные как подозрительные */
    suspicious: boolean('suspicious').notNull().default(false),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Растёт при каждом изменении — защита от одновременной правки с двух терминалов */
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('receipts_number_uq').on(t.tenantId, t.number),
    index('receipts_status_idx').on(t.branchId, t.status),
    index('receipts_closed_idx').on(t.tenantId, t.closedAt),
  ],
)

export const receiptItems = pgTable(
  'receipt_items',
  {
    id: id(),
    tenantId: tenantRef(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id),
    /** Снимок названия и цены на момент продажи */
    name: jsonb('name').$type<L10n>().notNull(),
    departmentId: uuid('department_id'),
    price: money('price'),
    /** Снимок себестоимости единицы на момент продажи */
    cost: money('cost'),
    /** Количество в тысячных: 1000 = 1 шт, 350 = 0,35 кг */
    qty: integer('qty').notNull().default(1000),
    modifiers: jsonb('modifiers')
      .$type<{ id: string; name: L10n; price: number }[]>()
      .notNull()
      .default([]),
    comment: text('comment'),
    discountAmount: money('discount_amount'),
    total: money('total'),
    /** Угощение: позиция за 0 с причиной */
    comp: boolean('comp').notNull().default(false),
    /** Когда отправлено на кухню; null — ещё не отправлено */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    reasonId: uuid('reason_id').references(() => reasons.id),
    addedBy: uuid('added_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('receipt_items_receipt_idx').on(t.receiptId)],
)

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantRef(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    methodId: uuid('method_id')
      .notNull()
      .references(() => paymentMethods.id),
    /** Отрицательная сумма — возврат */
    amount: money('amount'),
    userId: uuid('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('payments_receipt_idx').on(t.receiptId)],
)

/** Журнал действий: кто, когда и что сделал с чеком или в панели */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: uuid('user_id').references(() => users.id),
    receiptId: uuid('receipt_id').references(() => receipts.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    suspicious: boolean('suspicious').notNull().default(false),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_receipt_idx').on(t.receiptId),
    index('audit_tenant_idx').on(t.tenantId, t.createdAt),
  ],
)

// ───────────── Терминалы и Telegram ─────────────

export const terminals = pgTable(
  'terminals',
  {
    id: id(),
    tenantId: tenantRef(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    name: text('name').notNull(),
    /** Код, которым устройство привязывается к заведению */
    code: text('code').notNull(),
    active: boolean('active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('terminals_code_uq').on(t.code)],
)

export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: uuid('user_id').references(() => users.id),
    /** Заполняется, когда получатель отправил код боту */
    chatId: text('chat_id'),
    /** Одноразовый код привязки */
    code: text('code'),
    lang: text('lang').notNull().default('uz'),
    /** Какие уведомления включены */
    notify: jsonb('notify').$type<Record<string, boolean>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('telegram_chat_uq').on(t.tenantId, t.chatId)],
)

// ───────────── Платформа NeoPos ─────────────

/** Администраторы платформы: создают бренды, блокируют, сбрасывают пароли. */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: id(),
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('platform_admins_login_uq').on(t.login)],
)

/** Общие настройки платформы: ключ → значение (например, открыта ли регистрация). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
})
