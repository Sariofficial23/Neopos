import Anthropic from '@anthropic-ai/sdk'
import { HttpError } from './auth.js'

/**
 * ИИ-сводка для владельца: модель получает уже посчитанные программой цифры и пишет по ним короткий
 * понятный текст. Она ничего не считает и не видит базу — только то, что собрано в `facts`.
 * Ключ задаётся на сервере переменной ANTHROPIC_API_KEY; без него сводка недоступна.
 */

const MODEL = 'claude-opus-5-5'

export const aiConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)

let client: Anthropic | null = null

/** Постоянная часть запроса: правила. Меняется редко, поэтому кэшируется на стороне API. */
const SYSTEM = `Ты — помощник владельца кафе или ресторана в Узбекистане. Тебе дают готовые цифры из кассовой программы NeoPos за период и за такой же предыдущий период. Напиши владельцу короткую сводку.

Правила:
- Используй только цифры из данных. Ничего не выдумывай и не пересчитывай. Если данных для вывода нет — не делай вывод.
- Суммы — в сумах, с пробелами между разрядами (1 250 000). Количество в данных о товарах указано в штуках или килограммах.
- Пиши простым языком, без терминов и без таблиц. Обычный текст, короткие абзацы, заголовки разделов — отдельной строкой без символов разметки.
- Сначала главное: выручка, число чеков, средний чек и как это отличается от предыдущего периода (если предыдущий период есть и не пустой).
- Затем что продаётся лучше всего и что принесло больше всего прибыли, если себестоимость указана.
- Затем раздел о подозрительных действиях сотрудников. Называй сотрудника, что именно он делал и на какую сумму. Это не обвинение: формулируй как «стоит проверить». Если подозрительного нет — скажи это одной фразой.
- В конце — не больше трёх конкретных пунктов, на что владельцу посмотреть сегодня. Только то, что прямо следует из данных.
- Объём — до 250 слов. Без приветствий и без заключительных фраз.`

export type AiSummary = { text: string; model: string; inputTokens: number; outputTokens: number }

/** Просит модель написать сводку по собранным фактам на языке владельца. */
export async function writeSummary(facts: unknown, lang: 'uz' | 'ru'): Promise<AiSummary> {
  if (!aiConfigured()) throw new HttpError(503, 'ai_not_configured')
  client ??= new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Если модель откажется отвечать по соображениям безопасности, запрос сам повторится на запасной модели.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Язык ответа: ${lang === 'ru' ? 'русский' : 'узбекский (латиница)'}.\n\nДанные:\n${JSON.stringify(facts)}`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new HttpError(502, 'ai_failed')
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim()
    if (!text) throw new HttpError(502, 'ai_failed')
    return { text, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  } catch (err) {
    if (err instanceof HttpError) throw err
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, 'ai_bad_key')
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy')
    if (err instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'ai_unreachable')
    if (err instanceof Anthropic.APIError) throw new HttpError(502, 'ai_failed')
    throw err
  }
}
