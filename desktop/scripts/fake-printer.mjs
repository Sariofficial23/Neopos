// Имитация сетевого чекового принтера для проверки печати без железа.
// Принимает ESC/POS на порту, проверяет команды и сохраняет каждый напечатанный чек в PNG.
// Запуск: node desktop/scripts/fake-printer.mjs <порт> <папка для PNG>
import { mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import zlib from 'node:zlib'

const port = Number(process.argv[2] ?? 9101)
const outDir = process.argv[3] ?? '.'
mkdirSync(outDir, { recursive: true })

/** Чёрно-белая картинка (1 бит на точку) → PNG без сторонних библиотек. */
function png(width, height, rows) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 1 // глубина 1 бит
  ihdr[9] = 0 // оттенки серого
  // В ESC/POS 1 = чёрная точка, в PNG 1 = белая: инвертируем.
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), Buffer.from(r.map((b) => ~b & 0xff))])))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let jobNo = 0
net
  .createServer((sock) => {
    const parts = []
    sock.on('data', (d) => parts.push(d))
    sock.on('end', () => {
      const buf = Buffer.concat(parts)
      jobNo++
      const report = { job: jobNo, bytes: buf.length, init: buf[0] === 0x1b && buf[1] === 0x40, slips: 0, cuts: 0, images: [] }
      let i = 2
      let rows = []
      let width = 0
      const flush = () => {
        if (!rows.length) return
        report.slips++
        const file = path.join(outDir, `job${jobNo}-slip${report.slips}.png`)
        writeFileSync(file, png(width * 8, rows.length, rows))
        report.images.push({ file, width: width * 8, height: rows.length })
        rows = []
      }
      while (i < buf.length) {
        if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
          const x = buf[i + 4] | (buf[i + 5] << 8)
          const y = buf[i + 6] | (buf[i + 7] << 8)
          width = x
          const start = i + 8
          for (let r = 0; r < y; r++) rows.push([...buf.subarray(start + r * x, start + (r + 1) * x)])
          i = start + x * y
        } else if (buf[i] === 0x1d && buf[i + 1] === 0x56) {
          report.cuts++
          flush()
          i += 4
        } else i++
      }
      flush()
      console.log('JOB ' + JSON.stringify(report))
    })
  })
  .listen(port, '127.0.0.1', () => console.log(`fake printer on 127.0.0.1:${port}`))
