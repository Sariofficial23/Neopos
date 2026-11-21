/**
 * Все разрешения системы. Должность хранит список ключей.
 * Владелец (role.isOwner) имеет все разрешения независимо от списка.
 */
export const PERMISSIONS = {
  panel: [
    'menu.view',
    'menu.edit',
    'halls.edit',
    'sales.view',
    'sales.settings',
    'staff.view',
    'staff.edit',
    'customers.view',
    'customers.edit',
    'reports.view',
    'settings.edit',
  ],
  terminal: [
    'receipt.discount',
    'receipt.void_sent_item',
    'receipt.comp',
    'receipt.change_price',
    'receipt.refund',
    'receipt.reopen',
    'receipt.transfer',
    'receipt.see_all',
    'shift.open_close',
    'shift.cash_movement',
  ],
} as const

export type Permission =
  | (typeof PERMISSIONS.panel)[number]
  | (typeof PERMISSIONS.terminal)[number]

export const ALL_PERMISSIONS: string[] = [...PERMISSIONS.panel, ...PERMISSIONS.terminal]

export function sanitizePermissions(list: string[]): string[] {
  return [...new Set(list)].filter((p) => ALL_PERMISSIONS.includes(p))
}
