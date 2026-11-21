/**
 * Звук нажатия: мягкая «капля», как на iPhone. Синтезируется в браузере — без файлов, работает и без интернета.
 * Тихий и короткий, чтобы не надоедал за смену.
 */
let ctx: AudioContext | null = null

function drop() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    // Высота быстро падает — так звучит капля.
    osc.frequency.setValueAtTime(1100, t)
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.07)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.12)
  } catch {
    /* звук недоступен — работаем молча */
  }
}

/** Включает звук для всех кнопок кассы: плитки, цифры ПИН-кода, кнопки окон. */
export function installTapSound() {
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest('button, [role="button"], .switch')
      if (el && !(el as HTMLButtonElement).disabled) drop()
    },
    { capture: true, passive: true },
  )
}
