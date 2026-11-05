// Repite un script de bin/navegador en un Chromium NUEVO (sin la sesión de la herramienta) y dice si pasó.
// Uso: PW_CORE=<ruta a playwright-core> node replay.cjs <script.spec.ts>  → una línea JSON {ok, lineas, url, error}
const fs = require('fs')
const { chromium } = require(process.env.PW_CORE)
const src = fs.readFileSync(process.argv[2], 'utf8')
const head = 'async ({ page }) => {'
const body = src.slice(src.indexOf(head) + head.length, src.lastIndexOf('})'))
// playwright-core no trae expect: lo justo para las aserciones que escribe la herramienta.
const expect = (loc) => ({
  toBeVisible: () => loc.waitFor({ state: 'visible', timeout: 15000 }),
  toHaveValue: async (v) => { const got = await loc.inputValue(); if (got !== v) throw new Error(`toHaveValue: tiene «${got}», se esperaba «${v}»`) },
})
const lineas = body.split('\n').filter((l) => l.trim().startsWith('await ')).length
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  try {
    await new Function('page', 'expect', 'return (async () => {' + body + '})()')(page, expect)
    console.log(JSON.stringify({ ok: true, lineas, url: page.url() }))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, lineas, url: page.url(), error: e.message.split('\n')[0] }))
  } finally {
    await browser.close()
  }
})()
