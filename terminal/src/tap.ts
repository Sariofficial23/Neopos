/**
 * Звук нажатия: «пузырёк» (bubble) — короткий мягкий «блоп» с поднимающимся тоном.
 * Синтезируется в браузере — без файлов, работает и без интернета.
 */
let ctx: AudioContext | null = null

function click() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    // Тон быстро поднимается — так лопается пузырёк.
    osc.frequency.setValueAtTime(380, t)
    osc.frequency.exponentialRampToValueAtTime(1250, t + 0.055)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.08)
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
      if (el && !(el as HTMLButtonElement).disabled) click()
    },
    { capture: true, passive: true },
  )
}
