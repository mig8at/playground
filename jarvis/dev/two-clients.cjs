// Prueba que el puente de Chrome acepta VARIOS clientes de Playwright a la vez: éste se conecta como lo haría el
// motor del harness (sin ?client=jarvis), abre SU pestaña, la usa unos segundos y se va. Mientras tanto, una sesión
// de Jarvis puede seguir trabajando en la suya. Uso: node jarvis/dev/two-clients.cjs [url] [segundos]
// Antes del 2026-11-20 el puente rechazaba al segundo cliente con «ya hay otra conexión de Playwright».
const path = require('node:path')
const { chromium } = require(path.join(__dirname, '../../harness/node_modules/playwright'))

const url = process.argv[2] || 'http://localhost:5206'
const hold = Number(process.argv[3] || 8)

;(async () => {
  const t0 = Date.now()
  const browser = await chromium.connectOverCDP('ws://127.0.0.1:5203/api/chrome/cdp')
  const context = browser.contexts()[0]
  const seen = context.pages().length
  const page = await context.newPage()
  await page.goto(url)
  console.log(`cliente 2: conectado; veía ${seen} pestaña(s) ajenas; abrió la suya en ${url}: «${await page.title()}» (${Date.now() - t0} ms)`)
  for (let i = 0; i < hold; i++) {
    await page.waitForTimeout(1000)
    await page.evaluate(() => document.title) // que siga respondiendo mientras la otra trabaja
  }
  console.log(`cliente 2: su pestaña respondió ${hold} s seguidos; la cierra y se va`)
  await page.close()
  await browser.close()
})().catch((e) => { console.error('cliente 2 falló:', e.message); process.exit(1) })
