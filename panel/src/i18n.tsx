import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'uz' | 'ru'

const dict = {
  // Общее
  save: { uz: 'Saqlash', ru: 'Сохранить' },
  cancel: { uz: 'Bekor qilish', ru: 'Отмена' },
  create: { uz: 'Yaratish', ru: 'Создать' },
  edit: { uz: 'Tahrirlash', ru: 'Изменить' },
  delete: { uz: 'O‘chirish', ru: 'Удалить' },
  loading: { uz: 'Yuklanmoqda…', ru: 'Загрузка…' },
  yes: { uz: 'Ha', ru: 'Да' },
  no: { uz: 'Yo‘q', ru: 'Нет' },
  active: { uz: 'Faol', ru: 'Активен' },
  inactive: { uz: 'Nofaol', ru: 'Отключён' },
  soon: { uz: 'Bu bo‘lim keyingi bosqichda tayyorlanadi.', ru: 'Этот раздел появится на следующем этапе.' },
  confirmDelete: { uz: 'Rostdan ham o‘chirilsinmi?', ru: 'Действительно удалить?' },

  // Вход
  signIn: { uz: 'Kirish', ru: 'Войти' },
  signUp: { uz: 'Ro‘yxatdan o‘tish', ru: 'Регистрация' },
  signOut: { uz: 'Chiqish', ru: 'Выйти' },
  login: { uz: 'Login', ru: 'Логин' },
  password: { uz: 'Parol', ru: 'Пароль' },
  venueName: { uz: 'Muassasa nomi', ru: 'Название заведения' },
  yourName: { uz: 'Ismingiz', ru: 'Ваше имя' },
  haveAccount: { uz: 'Akkauntingiz bormi? Kirish', ru: 'Уже есть аккаунт? Войти' },
  noAccount: { uz: 'Akkaunt yo‘qmi? Ro‘yxatdan o‘ting', ru: 'Нет аккаунта? Зарегистрируйтесь' },
  tagline: { uz: 'Kafe va restoranlar uchun boshqaruv tizimi', ru: 'Система управления для кафе и ресторанов' },
  passwordHint: { uz: 'Kamida 8 ta belgi', ru: 'Не короче 8 символов' },
  loginHint: { uz: 'Lotin harflari va raqamlar, 3–32 belgi', ru: 'Латинские буквы и цифры, 3–32 символа' },

  // Меню панели
  navDashboard: { uz: 'Bosh sahifa', ru: 'Сводка' },
  navMenu: { uz: 'Menyu', ru: 'Меню' },
  navHalls: { uz: 'Zallar va stollar', ru: 'Залы и столы' },
  navReceipts: { uz: 'Cheklar', ru: 'Чеки' },
  navReports: { uz: 'Hisobotlar', ru: 'Отчёты' },
  navCustomers: { uz: 'Mijozlar', ru: 'Клиенты' },
  navStaff: { uz: 'Xodimlar', ru: 'Сотрудники' },
  navRoles: { uz: 'Lavozimlar', ru: 'Должности' },
  navSettings: { uz: 'Sozlamalar', ru: 'Настройки' },

  // Сводка
  welcome: { uz: 'Xush kelibsiz', ru: 'Добро пожаловать' },
  dashboardHint: {
    uz: 'Savdo ko‘rsatkichlari terminal ishga tushgach shu yerda paydo bo‘ladi.',
    ru: 'Показатели продаж появятся здесь, когда заработает терминал.',
  },

  // Сотрудники
  staffTitle: { uz: 'Xodimlar', ru: 'Сотрудники' },
  addStaff: { uz: 'Xodim qo‘shish', ru: 'Добавить сотрудника' },
  name: { uz: 'Ism', ru: 'Имя' },
  phone: { uz: 'Telefon', ru: 'Телефон' },
  role: { uz: 'Lavozim', ru: 'Должность' },
  status: { uz: 'Holat', ru: 'Статус' },
  pin: { uz: 'PIN-kod', ru: 'ПИН-код' },
  pinHint: { uz: 'Terminalga kirish uchun 4–6 raqam', ru: '4–6 цифр для входа в терминал' },
  pinSet: { uz: 'o‘rnatilgan', ru: 'задан' },
  pinKeep: { uz: 'O‘zgartirmaslik uchun bo‘sh qoldiring', ru: 'Оставьте пустым, чтобы не менять' },
  panelLogin: { uz: 'Panel uchun login', ru: 'Логин для панели' },
  panelLoginHint: { uz: 'Faqat panelga kiradigan xodimlar uchun', ru: 'Только тем, кто входит в панель' },
  language: { uz: 'Til', ru: 'Язык' },

  // Должности
  rolesTitle: { uz: 'Lavozimlar', ru: 'Должности' },
  addRole: { uz: 'Lavozim qo‘shish', ru: 'Добавить должность' },
  roleName: { uz: 'Lavozim nomi', ru: 'Название должности' },
  staffCount: { uz: 'Xodimlar', ru: 'Сотрудников' },
  panelAccess: { uz: 'Panelga kirish', ru: 'Доступ к панели' },
  terminalAccess: { uz: 'Terminalga kirish', ru: 'Доступ к терминалу' },
  ownerAll: { uz: 'Egasi — barcha huquqlar', ru: 'Владелец — все права' },
  permsPanel: { uz: 'Paneldagi huquqlar', ru: 'Права в панели' },
  permsTerminal: { uz: 'Terminaldagi huquqlar', ru: 'Права на терминале' },

  // Разрешения
  'perm.menu.view': { uz: 'Menyuni ko‘rish', ru: 'Просмотр меню' },
  'perm.menu.edit': { uz: 'Menyuni tahrirlash', ru: 'Изменение меню' },
  'perm.halls.edit': { uz: 'Zallar va stollar', ru: 'Залы и столы' },
  'perm.sales.view': { uz: 'Cheklarni ko‘rish', ru: 'Просмотр чеков' },
  'perm.sales.settings': { uz: 'Savdo sozlamalari', ru: 'Настройки продаж' },
  'perm.staff.view': { uz: 'Xodimlarni ko‘rish', ru: 'Просмотр сотрудников' },
  'perm.staff.edit': { uz: 'Xodimlar va lavozimlar', ru: 'Сотрудники и должности' },
  'perm.customers.view': { uz: 'Mijozlarni ko‘rish', ru: 'Просмотр клиентов' },
  'perm.customers.edit': { uz: 'Mijozlarni tahrirlash', ru: 'Изменение клиентов' },
  'perm.reports.view': { uz: 'Hisobotlar', ru: 'Отчёты' },
  'perm.settings.edit': { uz: 'Sozlamalar', ru: 'Настройки' },
  'perm.receipt.discount': { uz: 'Chegirma berish', ru: 'Делать скидку' },
  'perm.receipt.void_sent_item': {
    uz: 'Oshxonaga yuborilgan taomni o‘chirish',
    ru: 'Удалять позицию после отправки на кухню',
  },
  'perm.receipt.comp': { uz: 'Mehmon qilish (bepul)', ru: 'Угощение (бесплатно)' },
  'perm.receipt.change_price': { uz: 'Chekda narxni o‘zgartirish', ru: 'Менять цену в чеке' },
  'perm.receipt.refund': { uz: 'Chekni qaytarish', ru: 'Возврат чека' },
  'perm.receipt.reopen': { uz: 'Yopilgan chekni qayta ochish', ru: 'Открывать закрытый чек' },
  'perm.receipt.transfer': { uz: 'Chekni ko‘chirish va bo‘lish', ru: 'Перенос и разделение чека' },
  'perm.receipt.see_all': { uz: 'Barcha xodimlar cheklari', ru: 'Чеки всех сотрудников' },
  'perm.shift.open_close': { uz: 'Smenani ochish va yopish', ru: 'Открытие и закрытие смены' },
  'perm.shift.cash_movement': { uz: 'Kassaga pul kiritish/olish', ru: 'Внесение и изъятие денег' },

  // Меню
  tabProducts: { uz: 'Mahsulotlar', ru: 'Товары' },
  tabCategories: { uz: 'Kategoriyalar', ru: 'Категории' },
  tabDepartments: { uz: 'Bo‘limlar', ru: 'Отделы' },
  addProduct: { uz: 'Mahsulot qo‘shish', ru: 'Добавить товар' },
  addCategory: { uz: 'Kategoriya qo‘shish', ru: 'Добавить категорию' },
  addDepartment: { uz: 'Bo‘lim qo‘shish', ru: 'Добавить отдел' },
  nameUz: { uz: 'Nomi (o‘zbekcha)', ru: 'Название (узбекский)' },
  nameRu: { uz: 'Nomi (ruscha)', ru: 'Название (русский)' },
  nameOneEnough: { uz: 'Bitta tilda yozish kifoya', ru: 'Достаточно заполнить один язык' },
  price: { uz: 'Narx', ru: 'Цена' },
  category: { uz: 'Kategoriya', ru: 'Категория' },
  department: { uz: 'Bo‘lim', ru: 'Отдел' },
  departmentHint: { uz: 'Buyurtma qaysi printerga chiqadi', ru: 'На какой принтер уходит заказ' },
  noCategory: { uz: 'Kategoriyasiz', ru: 'Без категории' },
  allCategories: { uz: 'Barchasi', ru: 'Все' },
  barcode: { uz: 'Shtrix-kod', ru: 'Штрих-код' },
  unit: { uz: 'O‘lchov birligi', ru: 'Единица' },
  unitPcs: { uz: 'dona', ru: 'шт' },
  unitKg: { uz: 'kg', ru: 'кг' },
  unitL: { uz: 'litr', ru: 'л' },
  byWeight: { uz: 'Tortib sotiladi', ru: 'Продаётся на вес' },
  favorite: { uz: 'Tanlanganlar', ru: 'Избранное' },
  stopList: { uz: 'Stop-list', ru: 'Стоп-лист' },
  onSale: { uz: 'Sotuvda', ru: 'В продаже' },
  color: { uz: 'Plitka rangi', ru: 'Цвет плитки' },
  products: { uz: 'Mahsulotlar', ru: 'Товаров' },
  printer: { uz: 'Printer nomi', ru: 'Имя принтера' },
  search: { uz: 'Qidirish', ru: 'Поиск' },
  emptyList: { uz: 'Hozircha bo‘sh', ru: 'Пока пусто' },
  sum: { uz: 'so‘m', ru: 'сум' },

  // Залы и столы
  addHall: { uz: 'Zal qo‘shish', ru: 'Добавить зал' },
  hallName: { uz: 'Zal nomi', ru: 'Название зала' },
  addTable: { uz: 'Stol qo‘shish', ru: 'Добавить стол' },
  addTables: { uz: 'Bir nechta stol', ru: 'Несколько столов' },
  tableName: { uz: 'Stol nomi yoki raqami', ru: 'Название или номер стола' },
  seats: { uz: 'O‘rinlar', ru: 'Мест' },
  from: { uz: 'Dan', ru: 'С номера' },
  to: { uz: 'Gacha', ru: 'По номер' },
  noHalls: { uz: 'Avval zal qo‘shing', ru: 'Сначала добавьте зал' },
  noTables: { uz: 'Bu zalda stollar yo‘q', ru: 'В этом зале пока нет столов' },
  editHall: { uz: 'Zalni tahrirlash', ru: 'Изменить зал' },

  // Ошибки сервера
  'err.barcode_taken': { uz: 'Bu shtrix-kod boshqa mahsulotda bor', ru: 'Этот штрих-код уже у другого товара' },
  'err.category_in_use': { uz: 'Kategoriyada mahsulotlar bor', ru: 'В категории есть товары' },
  'err.department_in_use': { uz: 'Bo‘limga mahsulotlar biriktirilgan', ru: 'К отделу привязаны товары' },
  'err.table_name_taken': { uz: 'Bu nomli stol allaqachon bor', ru: 'Стол с таким названием уже есть' },
  'err.table_busy': { uz: 'Stolda ochiq chek bor', ru: 'За столом открыт чек' },
  'err.bad_credentials': { uz: 'Login yoki parol noto‘g‘ri', ru: 'Неверный логин или пароль' },
  'err.too_many_attempts': { uz: 'Urinishlar ko‘p. Bir daqiqadan so‘ng qayta urining.', ru: 'Слишком много попыток. Повторите через минуту.' },
  'err.login_taken': { uz: 'Bu login band', ru: 'Этот логин уже занят' },
  'err.pin_taken': { uz: 'Bu PIN-kod boshqa xodimda bor', ru: 'Этот ПИН-код уже у другого сотрудника' },
  'err.password_required': { uz: 'Login uchun parol kiriting', ru: 'Для логина нужен пароль' },
  'err.role_in_use': { uz: 'Bu lavozimda xodimlar bor', ru: 'К этой должности привязаны сотрудники' },
  'err.last_owner': { uz: 'Kamida bitta faol egasi qolishi kerak', ru: 'Должен остаться хотя бы один действующий владелец' },
  'err.cannot_delete_self': { uz: 'O‘zingizni o‘chira olmaysiz', ru: 'Нельзя удалить самого себя' },
  'err.cannot_disable_self': { uz: 'O‘zingizni o‘chirib qo‘ya olmaysiz', ru: 'Нельзя отключить самого себя' },
  'err.forbidden': { uz: 'Bu amal uchun ruxsat yo‘q', ru: 'Нет прав на это действие' },
  'err.validation': { uz: 'Maydonlarni tekshiring', ru: 'Проверьте заполнение полей' },
  'err.network': { uz: 'Server bilan aloqa yo‘q', ru: 'Нет связи с сервером' },
  'err.internal': { uz: 'Serverda xatolik', ru: 'Ошибка на сервере' },
} as const

export type Key = keyof typeof dict

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string; tErr: (code: string) => string }
const I18nContext = createContext<Ctx>(null!)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('neopos.lang')
    if (saved === 'uz' || saved === 'ru') return saved
  } catch {
    /* хранилище недоступно */
  }
  return 'uz'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    document.documentElement.lang = l
    try {
      localStorage.setItem('neopos.lang', l)
    } catch {
      /* хранилище недоступно */
    }
  }, [])
  const value = useMemo<Ctx>(() => {
    const t = (k: Key) => dict[k][lang]
    const tErr = (code: string) => {
      const k = `err.${code}` as Key
      return k in dict ? dict[k][lang] : dict['err.internal'][lang]
    }
    return { lang, setLang, t, tErr }
  }, [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)

export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n()
  return (
    <div className={`inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium ${className}`}>
      {(['uz', 'ru'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`cursor-pointer rounded-md px-2.5 py-1 ${lang === l ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          {l === 'uz' ? 'O‘z' : 'Рус'}
        </button>
      ))}
    </div>
  )
}
