/**
 * Звук нажатия: короткий сухой «клик», как у клавиатуры iPhone — без тона, едва слышный.
 * Синтезируется в браузере — без файлов, работает и без интернета.
 */
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

function click() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    // 25 мс шума, который быстро затухает: так звучит щелчок клавиши.
    if (!noise) {
      const len = Math.round(ctx.sampleRate * 0.025)
      noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6)
    }
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noise
    // Оставляем только «щелчок» в середине диапазона: без шипения и без гула.
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 2600
    band.Q.value = 0.9
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35, t)
    src.connect(band).connect(gain).connect(ctx.destination)
    src.start(t)
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
