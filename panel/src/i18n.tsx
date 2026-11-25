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
  navTerminals: { uz: 'Terminallar', ru: 'Терминалы' },
  navSupplies: { uz: 'Tovar kirimi', ru: 'Приход товаров' },
  setTerminal: { uz: 'Terminal', ru: 'Терминал' },
  tableRedMinutes: { uz: 'Stol rangini o‘zgartirish, daqiqa', ru: 'Изменение цвета стола, минут' },
  tableRedHint: {
    uz: 'Shuncha daqiqa chekka hech narsa qo‘shilmasa, stol kassada qizil bo‘ladi. 0 — o‘chirilgan. Tavsiya: 10–1000.',
    ru: 'Если столько минут в чек ничего не добавляли, стол на кассе становится красным. 0 — выключено. Обычно 10–1000.',
  },
  navSubscription: { uz: 'Abonent to‘lovi', ru: 'Абонентская плата' },
  downloadApp: { uz: 'Windows uchun kassani yuklab olish', ru: 'Скачать кассу для Windows' },
  navExpand: { uz: 'Menyuni to‘liq ochish', ru: 'Раскрыть меню полностью' },
  navCollapse: { uz: 'Menyuni yig‘ish', ru: 'Свернуть меню' },

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
  pinHiddenHint: {
    uz: 'PIN-kod xodim kassaga keyingi kirganida ko‘rinadi yoki uni qayta o‘rnating',
    ru: 'ПИН-код появится после следующего входа сотрудника на кассе, либо задайте его заново',
  },
  roleAdmin: { uz: 'Admin', ru: 'Админ' },
  roleSeller: { uz: 'Sotuvchi', ru: 'Продавец' },
  roleAdminHint: { uz: 'Boshqaruv paneliga kirish', ru: 'Вход в панель управления' },
  roleSellerHint: { uz: 'Kassada ishlash', ru: 'Работа на кассе' },
  rolePerms: { uz: 'Huquqlar', ru: 'Прав' },
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
  cost: { uz: 'Tannarx', ru: 'Себестоимость' },
  costHint: { uz: 'Bir dona uchun xarajat', ru: 'Затраты на одну единицу' },
  costEmpty: { uz: 'Tannarxni kiriting — foyda hisoblanadi', ru: 'Укажите себестоимость — посчитаем прибыль' },
  unitProfit: { uz: 'Bir donadan foyda', ru: 'Прибыль с единицы' },
  markup: { uz: 'Ustama', ru: 'Наценка' },
  margin: { uz: 'Marja', ru: 'Маржа' },
  kCost: { uz: 'Tannarx', ru: 'Себестоимость' },
  kProfit: { uz: 'Yalpi foyda', ru: 'Валовая прибыль' },
  noCostWarn: {
    uz: 'Ayrim mahsulotlarda tannarx kiritilmagan — ular bo‘yicha foyda oshirib ko‘rsatilgan. Shunday sotuvlar:',
    ru: 'У части товаров не указана себестоимость — прибыль по ним завышена. Продажи таких товаров:',
  },
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

  // Способы оплаты
  payMethods: { uz: 'To‘lov turlari', ru: 'Способы оплаты' },
  payMethodsHint: {
    uz: 'Kassada to‘lov oynasida faqat yoqilganlari chiqadi. Naqd pul tanlangan holda ochiladi.',
    ru: 'В окне оплаты на кассе видны только включённые. По умолчанию выбраны наличные.',
  },
  payMethodNew: { uz: 'Yangi to‘lov turi, masalan Uzum', ru: 'Новый способ, например Uzum' },
  payMethodKind: { uz: 'Turi', ru: 'Тип' },
  'payKind.cash': { uz: 'naqd (qaytim beriladi)', ru: 'наличные (со сдачей)' },
  'payKind.card': { uz: 'karta', ru: 'карта' },
  'payKind.transfer': { uz: 'o‘tkazma', ru: 'перевод' },
  'payKind.other': { uz: 'boshqa', ru: 'прочее' },
  'err.last_payment_method': { uz: 'Kamida bitta to‘lov turi yoqilgan bo‘lishi kerak', ru: 'Хотя бы один способ оплаты должен быть включён' },
  'err.payment_method_used': {
    uz: 'Bu turdagi to‘lovlar bor — o‘chirib bo‘lmaydi, uni o‘chirib qo‘ying (tugma)',
    ru: 'Этим способом уже платили — удалить нельзя, выключите его переключателем',
  },

  // Оформление кассы
  brandTitle: { uz: 'Kassa bezagi: logotip va muassasa surati', ru: 'Оформление кассы: логотип и фото заведения' },
  brandLogo: { uz: 'Logotip', ru: 'Логотип' },
  brandPhoto: { uz: 'Muassasa surati', ru: 'Фото заведения' },
  brandUpload: { uz: 'Rasm yuklash', ru: 'Загрузить фото' },
  brandReplace: { uz: 'Almashtirish', ru: 'Заменить' },
  brandLogoHint: { uz: 'Kassada chap yuqorida nomi bilan chiqadi. PNG yoki WebP, shaffof fon bilan yaxshi.', ru: 'Показывается на кассе слева сверху рядом с названием. Лучше PNG с прозрачным фоном.' },
  brandPhotoHint: {
    uz: 'Kassa fonida chiqadi: zal, ayvon yoki fasad surati. Katta rasm avtomatik kichraytiriladi.',
    ru: 'Ставится фоном кассы: зал, терраса или фасад. Большое фото уменьшится автоматически.',
  },
  'err.image_too_big': { uz: 'Rasm juda katta, boshqasini tanlang', ru: 'Слишком большое изображение, выберите другое' },
  'err.bad_image': { uz: 'Faqat JPG, PNG yoki WebP rasm', ru: 'Только изображения JPG, PNG или WebP' },

  // Категории расходов и операции кассы
  financeCats: { uz: 'Kassa xarajatlari va kirimlari kategoriyalari', ru: 'Категории расходов и доходов кассы' },
  financeCatsHint: {
    uz: 'Kassir «Operatsiya qo‘shish»da shu ro‘yxatdan tanlaydi. Ichki kategoriyalar ham bo‘lishi mumkin: «Kommunal → Internet».',
    ru: 'Кассир выбирает из этого списка в «Добавить операцию». Можно делать вложенные: «Коммунальные → Интернет».',
  },
  catExpense: { uz: 'Xarajatlar', ru: 'Расходы' },
  catIncome: { uz: 'Kirimlar', ru: 'Доходы' },
  catNewName: { uz: 'Yangi kategoriya nomi', ru: 'Название новой категории' },
  catParent: { uz: 'Joylashuvi', ru: 'Куда добавить' },
  catTopLevel: { uz: 'Asosiy kategoriya', ru: 'Основная категория' },
  catInside: { uz: 'Ichida', ru: 'Внутри' },
  catDeleteWithSubs: { uz: 'Ichki kategoriyalari bilan birga o‘chiriladi. Eski operatsiyalar saqlanadi.', ru: 'Удалится вместе с вложенными. Прошлые операции сохранятся.' },
  cashExpense: { uz: 'Kassadan xarajatlar', ru: 'Расходы из кассы' },
  cashIncome: { uz: 'Kassaga kirimlar', ru: 'Доходы в кассу' },
  cashCollection: { uz: 'Inkassatsiya', ru: 'Инкассация' },
  cashByCategory: { uz: 'Kassa operatsiyalari kategoriyalar bo‘yicha', ru: 'Операции кассы по категориям' },
  opsCount: { uz: 'Soni', ru: 'Кол-во' },

  // Настройки
  setVenue: { uz: 'Muassasa', ru: 'Заведение' },
  setPrint: { uz: 'Chek chop etish', ru: 'Печать чеков' },
  address: { uz: 'Manzil', ru: 'Адрес' },
  printKitchen: { uz: 'Oshxonaga chek chiqarish', ru: 'Печатать заказ на кухню' },
  printReceipt: { uz: 'Yopilganda chek chiqarish', ru: 'Печатать чек при закрытии' },
  setReceiptText: { uz: 'Chekda nima yoziladi', ru: 'Что написать в чеке' },
  receiptHeader: { uz: 'Nom ostidagi qator', ru: 'Строка под названием' },
  receiptHeaderHint: { uz: 'Masalan: Instagram: @neopos yoki Wi-Fi paroli', ru: 'Например: Instagram: @neopos или пароль Wi-Fi' },
  showTime: { uz: 'Sana va vaqtni ko‘rsatish', ru: 'Показывать дату и время' },
  showWaiter: { uz: 'Ofitsiant ismini ko‘rsatish', ru: 'Показывать имя официанта' },
  showGuests: { uz: 'Mehmonlar sonini ko‘rsatish', ru: 'Показывать число гостей' },
  receiptFooter: { uz: 'Chek ostidagi matn', ru: 'Текст внизу чека' },
  receiptFooterHint: { uz: 'Masalan: Tashrifingiz uchun rahmat!', ru: 'Например: Спасибо за визит!' },
  printNote: {
    uz: 'Kassa kompyuterdagi asosiy printerga chop etadi. Mehmon hisobi (predchek) kassadagi printer tugmasi bilan chiqariladi.',
    ru: 'Касса печатает на основной принтер компьютера. Счёт гостю (предчек) печатается кнопкой с принтером на кассе.',
  },
  receiptPreview: { uz: 'Chek ko‘rinishi', ru: 'Вид чека' },
  total: { uz: 'JAMI', ru: 'ИТОГО' },
  savedOk: { uz: 'Saqlandi', ru: 'Сохранено' },

  // Период
  pToday: { uz: 'Bugun', ru: 'Сегодня' },
  pYesterday: { uz: 'Kecha', ru: 'Вчера' },
  p7: { uz: '7 kun', ru: '7 дней' },
  p30: { uz: '30 kun', ru: '30 дней' },
  pMonth: { uz: 'Shu oy', ru: 'Этот месяц' },
  pvAll: { uz: 'Barchasi', ru: 'Все' },
  pvDeleted: { uz: 'O‘chirilgan', ru: 'Удалено' },
  restore: { uz: 'Tiklash', ru: 'Восстановить' },
  photo: { uz: 'Surat', ru: 'Фото' },
  photoHint: { uz: 'Kassadagi tugmada ko‘rinadi. JPG, PNG yoki WebP.', ru: 'Показывается на плитке кассы. JPG, PNG или WebP.' },
  photoAfterSave: { uz: 'Suratni saqlagandan keyin qo‘shish mumkin.', ru: 'Фото можно добавить после сохранения.' },
  allDepartments: { uz: 'Barcha bo‘limlar', ru: 'Все отделы' },
  noDepartment: { uz: 'Bo‘limsiz', ru: 'Без отдела' },
  pPrevMonth: { uz: 'O‘tgan oy', ru: 'Прошлый месяц' },
  rProducts: { uz: 'Tovarlar', ru: 'Товары' },
  rHistory: { uz: 'Tarix', ru: 'История' },
  rpProduct: { uz: 'Tovar', ru: 'Товар' },
  rpCategory: { uz: 'Kategoriya', ru: 'Категория' },
  rpDepartment: { uz: 'Bo‘lim', ru: 'Отдел' },
  rpNoCategory: { uz: 'Kategoriyasiz', ru: 'Без категории' },
  rpNoDepartment: { uz: 'Bo‘limsiz', ru: 'Без отдела' },
  rpQty: { uz: 'Soni', ru: 'Кол-во' },
  rpComp: { uz: 'Mehmon', ru: 'Угощение' },
  rpAmount: { uz: 'Summa', ru: 'Сумма' },
  rpMarkup: { uz: 'Ustama', ru: 'Наценка' },
  rpTotal: { uz: 'Jami', ru: 'Итого' },
  rhTime: { uz: 'Vaqt', ru: 'Время' },
  rhUser: { uz: 'Xodim', ru: 'Сотрудник' },
  rhAction: { uz: 'Amal', ru: 'Действие' },
  rhReceipt: { uz: 'Chek', ru: 'Чек' },
  rhDetails: { uz: 'Tafsilot', ru: 'Подробности' },
  rhLimit: { uz: 'oxirgi 2000 tasi ko‘rsatilgan', ru: 'показаны последние 2000' },
  stRefunded: { uz: 'Qaytarilgan', ru: 'Возврат' },
  rcTabClosed: { uz: 'Cheklar', ru: 'Чеки' },
  rcTabOpen: { uz: 'Ochiq', ru: 'Открытые' },
  rcTabDeleted: { uz: 'O‘chirilgan', ru: 'Удалено' },
  rcTabRefunded: { uz: 'Qaytarilgan', ru: 'Возвраты' },
  pFrom: { uz: 'Boshlanish sanasi', ru: 'Дата начала' },
  pTo: { uz: 'Tugash sanasi', ru: 'Дата окончания' },

  // Чеки
  rcNumber: { uz: 'Chek №', ru: 'Чек №' },
  rcOpened: { uz: 'Ochilgan', ru: 'Открыт' },
  rcClosed: { uz: 'Yopilgan', ru: 'Закрыт' },
  rcPlace: { uz: 'Stol / tur', ru: 'Стол / тип' },
  rcWaiter: { uz: 'Xodim', ru: 'Сотрудник' },
  rcPayment: { uz: 'To‘lov', ru: 'Оплата' },
  rcSum: { uz: 'Summa', ru: 'Сумма' },
  rcAll: { uz: 'Barchasi', ru: 'Все' },
  stOpen: { uz: 'Ochiq', ru: 'Открыт' },
  stClosed: { uz: 'Yopilgan', ru: 'Закрыт' },
  stCancelled: { uz: 'Bekor qilingan', ru: 'Отменён' },
  rcSuspicious: { uz: 'Shubhali', ru: 'Подозрительные' },
  rcSuspiciousHint: { uz: 'Shubhali amal bor', ru: 'Есть подозрительные действия' },
  rcFound: { uz: 'Topildi', ru: 'Найдено' },
  rcShown: { uz: 'dastlabki 500 tasi ko‘rsatilgan', ru: 'показаны первые 500' },
  exportCsv: { uz: 'Excel uchun yuklab olish', ru: 'Скачать для Excel' },
  rcItems: { uz: 'Tarkibi', ru: 'Состав' },
  rcHistory: { uz: 'Tarix', ru: 'История' },
  rcVoided: { uz: 'o‘chirilgan', ru: 'удалено' },
  rcGuests: { uz: 'Mehmonlar', ru: 'Гостей' },
  rcSubtotal: { uz: 'Summa', ru: 'Сумма' },
  rcDiscount: { uz: 'Chegirma', ru: 'Скидка' },
  rcService: { uz: 'Xizmat haqi', ru: 'Обслуживание' },
  table: { uz: 'Stol', ru: 'Стол' },
  'act.receipt.open': { uz: 'Chek ochildi', ru: 'Чек открыт' },
  'act.receipt.send': { uz: 'Oshxonaga yuborildi', ru: 'Отправлено на кухню' },
  'act.item.void': { uz: 'Taom o‘chirildi', ru: 'Позиция удалена' },
  'act.receipt.discount': { uz: 'Chegirma o‘zgartirildi', ru: 'Изменена скидка' },
  'act.receipt.bill': { uz: 'Hisob chop etildi', ru: 'Распечатан счёт' },
  'act.receipt.pay': { uz: 'To‘lov qabul qilindi', ru: 'Принята оплата' },
  'act.receipt.cancel': { uz: 'Chek bekor qilindi', ru: 'Чек отменён' },
  'act.receipt.reopen': { uz: 'Chek qayta ochildi', ru: 'Чек открыт повторно' },
  'act.receipt.move': { uz: 'Stol ko‘chirildi', ru: 'Перенос стола' },
  'act.receipt.refund': { uz: 'Qaytarish', ru: 'Возврат' },
  'act.item.price': { uz: 'Narx o‘zgartirildi', ru: 'Изменена цена' },
  'act.item.comp': { uz: 'Mehmon qilindi', ru: 'Угощение' },
  'act.item.uncomp': { uz: 'Mehmon bekor qilindi', ru: 'Угощение отменено' },

  // Отчёты
  kRevenue: { uz: 'Tushum', ru: 'Выручка' },
  kReceipts: { uz: 'Cheklar', ru: 'Чеков' },
  kAverage: { uz: 'O‘rtacha chek', ru: 'Средний чек' },
  kGuests: { uz: 'Mehmonlar', ru: 'Гостей' },
  kDiscounts: { uz: 'Chegirmalar', ru: 'Скидки' },
  kService: { uz: 'Xizmat haqi', ru: 'Обслуживание' },
  kVoids: { uz: 'O‘chirilgan taomlar', ru: 'Удалённые позиции' },
  chByDay: { uz: 'Kunlar bo‘yicha tushum', ru: 'Выручка по дням' },
  chByHour: { uz: 'Soatlar bo‘yicha tushum', ru: 'Выручка по часам' },
  rByMethod: { uz: 'To‘lov turlari', ru: 'Способы оплаты' },
  rBySaleType: { uz: 'Sotuv turlari', ru: 'Способы продаж' },
  rByWaiter: { uz: 'Xodimlar', ru: 'Сотрудники' },
  rByCategory: { uz: 'Kategoriyalar', ru: 'Категории' },
  rByProduct: { uz: 'Mahsulotlar', ru: 'Товары' },
  rShifts: { uz: 'Kassa smenalari', ru: 'Кассовые смены' },
  qty: { uz: 'Soni', ru: 'Кол-во' },
  share: { uz: 'Ulushi', ru: 'Доля' },
  noSales: { uz: 'Bu davrda savdo bo‘lmagan', ru: 'За этот период продаж нет' },
  itemsNote: {
    uz: 'Mahsulot va kategoriya summalari chegirma va xizmat haqisiz ko‘rsatilgan.',
    ru: 'Суммы по товарам и категориям показаны без скидок и платы за обслуживание.',
  },
  shNumber: { uz: 'Smena', ru: 'Смена' },
  shOpened: { uz: 'Ochildi', ru: 'Открыта' },
  shClosed: { uz: 'Yopildi', ru: 'Закрыта' },
  shExpected: { uz: 'Kassada bo‘lishi kerak', ru: 'Должно быть' },
  shCounted: { uz: 'Sanaldi', ru: 'Насчитано' },
  shDiff: { uz: 'Farq', ru: 'Расхождение' },
  shStillOpen: { uz: 'ochiq', ru: 'открыта' },
  todayTitle: { uz: 'Bugungi savdo', ru: 'Продажи сегодня' },
  allReports: { uz: 'Barcha hisobotlar', ru: 'Все отчёты' },

  // Залы и столы
  addHall: { uz: 'Zal qo‘shish', ru: 'Добавить зал' },
  hallName: { uz: 'Zal nomi', ru: 'Название зала' },
  addTable: { uz: 'Stol qo‘shish', ru: 'Добавить стол' },
  addTables: { uz: 'Bir nechta stol', ru: 'Несколько столов' },
  tableName: { uz: 'Stol nomi yoki raqami', ru: 'Название или номер стола' },
  seats: { uz: 'O‘rinlar', ru: 'Мест' },
  servicePercent: { uz: 'Xizmat haqi', ru: 'Плата за обслуживание' },
  servicePercentHint: {
    uz: 'Shu stoldagi yangi cheklarga qo‘shiladi. Istalgan vaqtda o‘zgartirish mumkin. 0 — xizmat haqisiz.',
    ru: 'Добавляется к новым чекам этого стола. Можно изменить в любое время. 0 — без обслуживания.',
  },
  serviceForAll: { uz: 'Zaldagi barcha stollar uchun xizmat haqi', ru: 'Обслуживание для всех столов зала' },
  serviceForAllHint: {
    uz: 'To‘ldirsangiz — zaldagi hamma stolga shu foiz qo‘yiladi. Bo‘sh qoldirsangiz — o‘zgarmaydi.',
    ru: 'Если заполнить — этот процент встанет у всех столов зала. Если оставить пустым — ничего не изменится.',
  },
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
  'err.venue_blocked': {
    uz: 'Muassasa bloklangan. NeoPos bilan bog‘laning.',
    ru: 'Заведение заблокировано. Свяжитесь с NeoPos.',
  },
  'err.registration_closed': { uz: 'Ro‘yxatdan o‘tish yopiq', ru: 'Регистрация закрыта' },
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
    // Ключ может прийти с сервера (например, действие в истории чека) — неизвестный показываем как есть.
    const t = (k: Key) => (dict[k] as Record<Lang, string> | undefined)?.[lang] ?? k
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
