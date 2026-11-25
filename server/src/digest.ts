/**
 * Бесплатная сводка для владельца: текст пишет сама программа по правилам, без искусственного интеллекта.
 * Получает тот же набор цифр, что и ИИ-сводка, поэтому ничего не стоит, работает без интернета-сервисов
 * и не может исказить суммы.
 */

type Lang = 'uz' | 'ru'
type Totals = { receipts: number; revenue: number; guests: number; discounts: number; service: number; average: number; cost: number; profit: number; noCostAmount: number }
export type DigestFacts = {
  period: { from: string; to: string; days: number }
  totals: Totals
  previousPeriodTotals: Totals | null
  paymentMethods: { name: string; amount: number }[]
  waiters: { name: string; receipts: number; revenue: number }[]
  topProducts: { name: string; qty: number; amount: number; cost: number; profit: number }[]
  voidedItems: { count: number; amount: number }
  cashOperations: { expense: number; income: number; collection: number }
  suspicious: {
    totals: { voidAfterBill: number; refunds: number; comps: number; high: number }
    employees: { name: string; closedReceipts: number; riskLevel: string; standsOut: boolean; counts: Record<string, number>; amounts: Record<string, number> }[]
  }
}

const money = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ |,/g, ' ')
const qtyText = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')

const T = {
  ru: {
    main: 'Главное',
    noSales: 'За этот период продаж не было.',
    revenue: (r: string, n: number, a: string) => `Выручка ${r} сум, чеков ${n}, средний чек ${a} сум.`,
    guests: (g: number) => `Гостей: ${g}.`,
    up: (p: number, was: string) => `Это на ${p}% больше, чем за предыдущий такой же период (было ${was} сум).`,
    down: (p: number, was: string) => `Это на ${p}% меньше, чем за предыдущий такой же период (было ${was} сум).`,
    same: (was: string) => `Почти столько же, сколько за предыдущий такой же период (${was} сум).`,
    profit: (p: string, m: number) => `Валовая прибыль ${p} сум — это ${m}% от выручки.`,
    noCost: (a: string) => `У товаров на ${a} сум не указана себестоимость, поэтому прибыль завышена.`,
    discounts: (d: string, p: number) => `Скидок дано на ${d} сум (${p}% от выручки).`,
    sells: 'Что продаётся',
    best: 'Больше всего выручки принесли:',
    item: (i: number, n: string, q: string, a: string) => `${i}. ${n} — ${q} шт., ${a} сум`,
    mostProfit: (n: string, p: string) => `Больше всего прибыли дал товар «${n}»: ${p} сум.`,
    staff: 'Сотрудники',
    topWaiter: (n: string, r: string, c: number) => `Больше всех продал(а) ${n}: ${r} сум, чеков ${c}.`,
    others: (list: string) => `Остальные: ${list}.`,
    payments: 'Оплата',
    cashOps: (e: string, i: string, c: string) => `Операции кассы: расходы ${e} сум, доходы ${i} сум, инкассация ${c} сум.`,
    check: 'Стоит проверить',
    clean: 'Подозрительных действий за период нет.',
    risk: { high: 'высокий риск', medium: 'средний риск', low: 'низкий риск' } as Record<string, string>,
    stands: 'заметно больше остальных',
    kinds: {
      void_after_bill: 'удаление после счёта',
      refund: 'возврат',
      reopen: 'повторное открытие чека',
      price_down: 'снижение цены',
      discount: 'большая скидка',
      comp: 'угощение',
      cash_diff: 'расхождение кассы',
      unlock: 'снятие блокировки',
      void: 'удаление позиции',
    } as Record<string, string>,
    times: (n: number) => `${n} раз`,
    on: (a: string) => ` на ${a} сум`,
    notAccusation: 'Это не обвинение, а список того, что стоит посмотреть в отчёте «Подозрительные».',
    todo: 'На что посмотреть сегодня',
    todoDrop: (p: number) => `Выручка упала на ${p}% — проверьте, что изменилось: меню, персонал, часы работы.`,
    todoHigh: (names: string) => `Откройте отчёт «Подозрительные» и просмотрите случаи сотрудника: ${names}.`,
    todoVoid: (a: string) => `После выданного счёта из чеков удалено позиций на ${a} сум — посмотрите эти чеки.`,
    todoCost: 'Укажите себестоимость товаров в меню — без неё прибыль считается неверно.',
    todoDisc: (p: number) => `Скидки составляют ${p}% выручки — проверьте, кто и за что их даёт.`,
    todoNone: 'Особых замечаний нет.',
  },
  uz: {
    main: 'Asosiysi',
    noSales: 'Bu davrda savdo bo‘lmagan.',
    revenue: (r: string, n: number, a: string) => `Tushum ${r} so‘m, cheklar ${n} ta, o‘rtacha chek ${a} so‘m.`,
    guests: (g: number) => `Mehmonlar: ${g}.`,
    up: (p: number, was: string) => `Bu avvalgi shunday davrga nisbatan ${p}% ko‘p (${was} so‘m edi).`,
    down: (p: number, was: string) => `Bu avvalgi shunday davrga nisbatan ${p}% kam (${was} so‘m edi).`,
    same: (was: string) => `Avvalgi shunday davr bilan deyarli bir xil (${was} so‘m).`,
    profit: (p: string, m: number) => `Yalpi foyda ${p} so‘m — tushumning ${m}%.`,
    noCost: (a: string) => `${a} so‘mlik tovarlarda tannarx ko‘rsatilmagan, shuning uchun foyda oshirib ko‘rsatilgan.`,
    discounts: (d: string, p: number) => `Chegirmalar ${d} so‘m (tushumning ${p}%).`,
    sells: 'Nima sotilmoqda',
    best: 'Eng ko‘p tushum keltirganlar:',
    item: (i: number, n: string, q: string, a: string) => `${i}. ${n} — ${q} dona, ${a} so‘m`,
    mostProfit: (n: string, p: string) => `Eng ko‘p foydani «${n}» berdi: ${p} so‘m.`,
    staff: 'Xodimlar',
    topWaiter: (n: string, r: string, c: number) => `Eng ko‘p sotgan: ${n} — ${r} so‘m, ${c} ta chek.`,
    others: (list: string) => `Qolganlar: ${list}.`,
    payments: 'To‘lov',
    cashOps: (e: string, i: string, c: string) => `Kassa amallari: xarajat ${e} so‘m, kirim ${i} so‘m, inkassatsiya ${c} so‘m.`,
    check: 'Tekshirish kerak',
    clean: 'Bu davrda shubhali amallar yo‘q.',
    risk: { high: 'yuqori xavf', medium: 'o‘rta xavf', low: 'past xavf' } as Record<string, string>,
    stands: 'boshqalardan ancha ko‘p',
    kinds: {
      void_after_bill: 'hisobdan keyin o‘chirish',
      refund: 'qaytarish',
      reopen: 'chekni qayta ochish',
      price_down: 'narxni tushirish',
      discount: 'katta chegirma',
      comp: 'mehmon qilish',
      cash_diff: 'kassa farqi',
      unlock: 'blokni olish',
      void: 'taomni o‘chirish',
    } as Record<string, string>,
    times: (n: number) => `${n} marta`,
    on: (a: string) => `, ${a} so‘m`,
    notAccusation: 'Bu ayb emas — «Shubhali» hisobotida ko‘rib chiqish uchun ro‘yxat.',
    todo: 'Bugun nimaga e’tibor berish kerak',
    todoDrop: (p: number) => `Tushum ${p}% kamaydi — nima o‘zgarganini tekshiring: menyu, xodimlar, ish vaqti.`,
    todoHigh: (names: string) => `«Shubhali» hisobotini ochib, shu xodim hodisalarini ko‘rib chiqing: ${names}.`,
    todoVoid: (a: string) => `Hisob chiqarilgandan keyin cheklardan ${a} so‘mlik taom o‘chirilgan — shu cheklarni ko‘ring.`,
    todoCost: 'Menyuda tovarlar tannarxini kiriting — usiz foyda noto‘g‘ri hisoblanadi.',
    todoDisc: (p: number) => `Chegirmalar tushumning ${p}% ini tashkil qiladi — kim va nima uchun berayotganini tekshiring.`,
    todoNone: 'Alohida izoh yo‘q.',
  },
}

/** Порядок действий в строке сотрудника — от самого опасного. */
const KIND_ORDER = ['void_after_bill', 'cash_diff', 'refund', 'reopen', 'price_down', 'discount', 'comp', 'unlock', 'void']

export function writeDigest(f: DigestFacts, lang: Lang): string {
  const t = T[lang]
  const out: string[] = []
  const tot = f.totals
  const prev = f.previousPeriodTotals

  // ── Главное ──
  out.push(t.main)
  if (!tot.receipts) {
    out.push(t.noSales)
  } else {
    out.push(t.revenue(money(tot.revenue), tot.receipts, money(tot.average)))
    if (tot.guests > 0) out.push(t.guests(tot.guests))
    if (prev && prev.revenue > 0) {
      const change = Math.round(((tot.revenue - prev.revenue) / prev.revenue) * 100)
      out.push(Math.abs(change) < 3 ? t.same(money(prev.revenue)) : change > 0 ? t.up(change, money(prev.revenue)) : t.down(-change, money(prev.revenue)))
    }
    if (tot.cost > 0) out.push(t.profit(money(tot.profit), Math.round((tot.profit / tot.revenue) * 100)))
    if (tot.noCostAmount > 0) out.push(t.noCost(money(tot.noCostAmount)))
    if (tot.discounts > 0) out.push(t.discounts(money(tot.discounts), Math.round((tot.discounts / (tot.revenue + tot.discounts)) * 100)))
  }

  // ── Что продаётся ──
  if (f.topProducts.length) {
    out.push('', t.sells, t.best)
    f.topProducts.slice(0, 3).forEach((p, i) => out.push(t.item(i + 1, p.name, qtyText(p.qty), money(p.amount))))
    const profitable = [...f.topProducts].filter((p) => p.cost > 0).sort((a, b) => b.profit - a.profit)[0]
    if (profitable && profitable.profit > 0) out.push(t.mostProfit(profitable.name, money(profitable.profit)))
  }

  // ── Сотрудники ──
  if (f.waiters.length) {
    out.push('', t.staff)
    const [top, ...rest] = f.waiters
    out.push(t.topWaiter(top.name, money(top.revenue), top.receipts))
    if (rest.length) out.push(t.others(rest.slice(0, 4).map((w) => `${w.name} — ${money(w.revenue)}`).join('; ')))
  }

  // ── Оплата и касса ──
  const paid = f.paymentMethods.filter((m) => m.amount > 0)
  const ops = f.cashOperations
  if (paid.length || ops.expense || ops.income || ops.collection) {
    out.push('', t.payments)
    if (paid.length) out.push(paid.map((m) => `${m.name}: ${money(m.amount)}`).join('; ') + '.')
    if (ops.expense || ops.income || ops.collection) out.push(t.cashOps(money(ops.expense), money(ops.income), money(ops.collection)))
  }

  // ── Стоит проверить ──
  out.push('', t.check)
  const risky = f.suspicious.employees.filter((e) => e.riskLevel !== 'low')
  if (!risky.length) {
    out.push(t.clean)
  } else {
    for (const e of risky.slice(0, 5)) {
      const parts = KIND_ORDER.filter((k) => e.counts[k] > 0).map((k) => `${t.kinds[k]} — ${t.times(e.counts[k])}${e.amounts[k] ? t.on(money(e.amounts[k])) : ''}`)
      out.push(`${e.name} (${t.risk[e.riskLevel] ?? e.riskLevel}${e.standsOut ? `, ${t.stands}` : ''}): ${parts.join('; ')}.`)
    }
    out.push(t.notAccusation)
  }

  // ── На что посмотреть сегодня: не больше трёх пунктов, только то, что следует из цифр ──
  const todo: string[] = []
  const high = f.suspicious.employees.filter((e) => e.riskLevel === 'high').map((e) => e.name)
  if (high.length) todo.push(t.todoHigh(high.slice(0, 3).join(', ')))
  if (f.suspicious.totals.voidAfterBill > 0) todo.push(t.todoVoid(money(f.suspicious.totals.voidAfterBill)))
  if (prev && prev.revenue > 0 && tot.revenue < prev.revenue * 0.85) todo.push(t.todoDrop(Math.round((1 - tot.revenue / prev.revenue) * 100)))
  const discShare = tot.revenue + tot.discounts > 0 ? Math.round((tot.discounts / (tot.revenue + tot.discounts)) * 100) : 0
  if (discShare >= 10) todo.push(t.todoDisc(discShare))
  if (tot.revenue > 0 && tot.noCostAmount > tot.revenue * 0.2) todo.push(t.todoCost)
  out.push('', t.todo)
  if (!todo.length) out.push(t.todoNone)
  else todo.slice(0, 3).forEach((line, i) => out.push(`${i + 1}. ${line}`))

  return out.join('\n')
}
