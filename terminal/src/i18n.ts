import type { Lang } from './api'

const dict = {
  tagline: { uz: 'Kassa terminali', ru: 'Терминал продаж' },
  activateTitle: { uz: 'Qurilmani ulash', ru: 'Привязка устройства' },
  activateHint: {
    uz: 'Bir marta boshqaruv paneli logini va parolini kiriting.',
    ru: 'Один раз введите логин и пароль от панели управления.',
  },
  login: { uz: 'Login', ru: 'Логин' },
  password: { uz: 'Parol', ru: 'Пароль' },
  deviceName: { uz: 'Qurilma nomi', ru: 'Название устройства' },
  connect: { uz: 'Ulash', ru: 'Привязать' },
  enterPin: { uz: 'PIN-kodni kiriting', ru: 'Введите ПИН-код' },
  loading: { uz: 'Yuklanmoqda…', ru: 'Загрузка…' },

  shiftClosed: { uz: 'Smena yopiq', ru: 'Смена закрыта' },
  shiftAsk: { uz: 'Ishni boshlash uchun smenani oching.', ru: 'Чтобы начать работу, откройте смену.' },
  shiftNoRight: {
    uz: 'Smenani ochish uchun administratorni chaqiring.',
    ru: 'Позовите администратора, чтобы открыть смену.',
  },
  cashInDrawer: { uz: 'Kassadagi naqd pul', ru: 'Наличные в кассе' },
  openShift: { uz: 'Smenani ochish', ru: 'Открыть смену' },
  closeShift: { uz: 'Smenani yopish', ru: 'Закрыть смену' },
  shift: { uz: 'Smena', ru: 'Смена' },
  shiftReceipts: { uz: 'Cheklar', ru: 'Чеков' },
  revenue: { uz: 'Tushum', ru: 'Выручка' },
  expectedCash: { uz: 'Kassada bo‘lishi kerak', ru: 'Должно быть в кассе' },
  countedCash: { uz: 'Haqiqatda sanaldi', ru: 'Насчитано по факту' },
  difference: { uz: 'Farq', ru: 'Расхождение' },
  hasOpenReceipts: { uz: 'Avval ochiq cheklarni yoping', ru: 'Сначала закройте открытые чеки' },

  newOrder: { uz: 'Yangi buyurtma', ru: 'Новый заказ' },
  receipts: { uz: 'Cheklar', ru: 'Чеки' },
  openReceipts: { uz: 'Ochiq cheklar', ru: 'Открытые чеки' },
  noOpenReceipts: { uz: 'Ochiq cheklar yo‘q', ru: 'Открытых чеков нет' },
  logout: { uz: 'Chiqish', ru: 'Выйти' },
  noTables: { uz: 'Stollar panelda qo‘shiladi', ru: 'Столы добавляются в панели управления' },
  free: { uz: 'Bo‘sh', ru: 'Свободен' },
  table: { uz: 'Stol', ru: 'Стол' },
  noTable: { uz: 'Stolsiz', ru: 'Без стола' },
  saleType: { uz: 'Sotuv turi', ru: 'Способ продажи' },
  min: { uz: 'daq', ru: 'мин' },

  back: { uz: 'Stollarga qaytish', ru: 'Назад к столам' },
  discount: { uz: 'Chegirma', ru: 'Скидка' },
  comment: { uz: 'Izoh', ru: 'Комментарий' },
  guests: { uz: 'Mehmonlar soni', ru: 'Количество гостей' },
  printBill: { uz: 'Hisobni chop etish', ru: 'Печать счёта гостю' },
  printFailed: { uz: 'Chop etib bo‘lmadi', ru: 'Не удалось напечатать' },
  printer: { uz: 'Chek printeri', ru: 'Принтер чеков' },
  printerDefault: { uz: 'Windows asosiy printeri', ru: 'Основной принтер Windows' },
  printerTest: { uz: 'Sinov cheki', ru: 'Пробная печать' },
  printerTestText: { uz: 'Printer ishlayapti', ru: 'Принтер работает' },
  appVersion: { uz: 'Ilova versiyasi', ru: 'Версия приложения' },
  downloadApp: { uz: 'Windows uchun kassani yuklab olish', ru: 'Скачать кассу для Windows' },
  emptyCheck: { uz: 'Chek bo‘sh', ru: 'Чек пуст' },
  service: { uz: 'xizmat haqi', ru: 'обслуживание' },
  send: { uz: 'Yuborish', ru: 'Отправить' },
  closeCheck: { uz: 'Chekni yopish', ru: 'Закрыть чек' },
  allCategories: { uz: 'Barcha kategoriyalar', ru: 'Все категории' },
  search: { uz: 'Qidirish', ru: 'Поиск' },
  stop: { uz: 'STOP', ru: 'СТОП' },
  nothingFound: { uz: 'Hech narsa topilmadi', ru: 'Ничего не найдено' },

  qty: { uz: 'Miqdor', ru: 'Количество' },
  remove: { uz: 'O‘chirish', ru: 'Удалить' },
  done: { uz: 'Tayyor', ru: 'Готово' },
  cancel: { uz: 'Bekor qilish', ru: 'Отмена' },
  save: { uz: 'Saqlash', ru: 'Сохранить' },
  voidTitle: { uz: 'O‘chirish sababi', ru: 'Причина удаления' },
  percent: { uz: 'Foiz', ru: 'Процент' },
  amount: { uz: 'Summa', ru: 'Сумма' },
  removeDiscount: { uz: 'Chegirmani olib tashlash', ru: 'Убрать скидку' },
  commentHint: { uz: 'Oshxona uchun izoh', ru: 'Заметка для кухни' },

  payment: { uz: 'To‘lov', ru: 'Оплата' },
  toPay: { uz: 'To‘lash kerak', ru: 'К оплате' },
  exact: { uz: 'Aniq summa', ru: 'Без сдачи' },
  change: { uz: 'Qaytim', ru: 'Сдача' },
  remaining: { uz: 'Yetishmayapti', ru: 'Не хватает' },
  pay: { uz: 'To‘lovni qabul qilish', ru: 'Принять оплату' },
  paid: { uz: 'Chek yopildi', ru: 'Чек закрыт' },
  sum: { uz: 'so‘m', ru: 'сум' },

  'err.network': { uz: 'Server bilan aloqa yo‘q', ru: 'Нет связи с сервером' },
  'err.internal': { uz: 'Xatolik yuz berdi', ru: 'Произошла ошибка' },
  'err.bad_credentials': { uz: 'Login yoki parol noto‘g‘ri', ru: 'Неверный логин или пароль' },
  'err.forbidden': { uz: 'Bu hisobda ruxsat yo‘q', ru: 'У этой учётной записи нет прав' },
  'err.venue_blocked': { uz: 'Muassasa bloklangan. NeoPos bilan bog‘laning.', ru: 'Заведение заблокировано. Свяжитесь с NeoPos.' },
  'err.bad_pin': { uz: 'PIN-kod noto‘g‘ri', ru: 'Неверный ПИН-код' },
  'err.too_many_attempts': { uz: 'Urinishlar ko‘p. Bir daqiqa kuting.', ru: 'Слишком много попыток. Подождите минуту.' },
  'err.device_not_activated': { uz: 'Qurilma ulanmagan', ru: 'Устройство не привязано' },
  'err.no_permission': { uz: 'Bu amal uchun ruxsat yo‘q', ru: 'Нет прав на это действие' },
  'err.shift_closed': { uz: 'Smena yopiq', ru: 'Смена закрыта' },
  'err.shift_already_open': { uz: 'Smena allaqachon ochiq', ru: 'Смена уже открыта' },
  'err.open_receipts': { uz: 'Avval ochiq cheklarni yoping', ru: 'Сначала закройте открытые чеки' },
  'err.table_taken': { uz: 'Bu stolga boshqa xodim xizmat qilmoqda', ru: 'Этот стол обслуживает другой сотрудник' },
  'err.product_stopped': { uz: 'Mahsulot stop-listda', ru: 'Товар в стоп-листе' },
  'err.receipt_closed': { uz: 'Chek allaqachon yopilgan', ru: 'Чек уже закрыт' },
  'err.receipt_empty': { uz: 'Chek bo‘sh', ru: 'Чек пуст' },
  'err.item_already_sent': { uz: 'Taom oshxonaga yuborilgan', ru: 'Позиция уже отправлена на кухню' },
  'err.not_enough_paid': { uz: 'To‘lov summasi yetarli emas', ru: 'Сумма оплаты меньше суммы чека' },
  'err.overpaid_non_cash': { uz: 'Qaytim faqat naqd puldan beriladi', ru: 'Сдача возможна только с наличных' },
  'err.validation': { uz: 'Ma’lumotlarni tekshiring', ru: 'Проверьте введённые данные' },
} as const

export type Key = keyof typeof dict

export function makeT(lang: Lang) {
  const t = (k: Key) => dict[k][lang]
  const tErr = (code: string) => {
    const k = `err.${code}` as Key
    return k in dict ? dict[k][lang] : dict['err.internal'][lang]
  }
  return { t, tErr }
}
