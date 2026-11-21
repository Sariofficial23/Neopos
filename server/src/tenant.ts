import { schema, type DB } from './db/index.js'
import { hashPassword } from './auth.js'

export type NewTenant = {
  venue: string
  ownerName: string
  login: string
  password: string
  lang: 'uz' | 'ru'
}

/** Создаёт заведение с владельцем и стартовыми справочниками, чтобы сразу можно было работать. */
export async function createTenant(db: DB, input: NewTenant) {
  const passwordHash = await hashPassword(input.password)
  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(schema.tenants).values({ name: input.venue }).returning()
    const tenantId = tenant.id

    const [branch] = await tx
      .insert(schema.branches)
      .values({ tenantId, name: input.venue })
      .returning()

    const [ownerRole] = await tx
      .insert(schema.roles)
      .values({
        tenantId,
        name: input.lang === 'ru' ? 'Владелец' : 'Egasi',
        isOwner: true,
        panelAccess: true,
        terminalAccess: true,
      })
      .returning()

    await tx.insert(schema.roles).values([
      {
        tenantId,
        name: input.lang === 'ru' ? 'Администратор' : 'Administrator',
        panelAccess: true,
        terminalAccess: true,
        permissions: [
          'menu.view',
          'menu.edit',
          'halls.edit',
          'sales.view',
          'staff.view',
          'customers.view',
          'customers.edit',
          'reports.view',
          'receipt.discount',
          'receipt.void_sent_item',
          'receipt.comp',
          'receipt.refund',
          'receipt.reopen',
          'receipt.transfer',
          'receipt.see_all',
          'shift.open_close',
          'shift.cash_movement',
        ],
      },
      {
        tenantId,
        name: input.lang === 'ru' ? 'Кассир' : 'Kassir',
        terminalAccess: true,
        permissions: ['receipt.see_all', 'receipt.transfer', 'shift.open_close'],
      },
      {
        tenantId,
        name: input.lang === 'ru' ? 'Официант' : 'Ofitsiant',
        terminalAccess: true,
        permissions: [],
      },
    ])

    const [owner] = await tx
      .insert(schema.users)
      .values({
        tenantId,
        roleId: ownerRole.id,
        name: input.ownerName,
        login: input.login,
        passwordHash,
        lang: input.lang,
      })
      .returning()

    await tx.insert(schema.departments).values([
      { tenantId, name: input.lang === 'ru' ? 'Кухня' : 'Oshxona' },
      { tenantId, name: 'Bar' },
    ])

    await tx.insert(schema.saleTypes).values([
      { tenantId, kind: 'hall', name: { uz: 'Zalda', ru: 'В зале' }, serviceBp: 1000, sort: 1 },
      { tenantId, kind: 'takeaway', name: { uz: 'Olib ketish', ru: 'С собой' }, sort: 2 },
      { tenantId, kind: 'delivery', name: { uz: 'Yetkazib berish', ru: 'Доставка' }, sort: 3 },
    ])

    await tx.insert(schema.paymentMethods).values([
      { tenantId, kind: 'cash', name: { uz: 'Naqd', ru: 'Наличные' }, sort: 1 },
      { tenantId, kind: 'card', name: { uz: 'Karta', ru: 'Карта' }, sort: 2 },
    ])

    await tx.insert(schema.reasons).values([
      { tenantId, kind: 'void', name: { uz: 'Mijoz rad etdi', ru: 'Гость отказался' } },
      { tenantId, kind: 'void', name: { uz: 'Xato kiritildi', ru: 'Ошибка ввода' } },
      { tenantId, kind: 'void', name: { uz: 'Mahsulot tugadi', ru: 'Товар закончился' } },
      { tenantId, kind: 'refund', name: { uz: 'Sifatdan norozi', ru: 'Претензия к качеству' } },
      { tenantId, kind: 'comp', name: { uz: 'Muassasa hisobidan', ru: 'За счёт заведения' } },
    ])

    return { tenant, branch, owner }
  })
}
