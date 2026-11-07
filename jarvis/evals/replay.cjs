// Repite un script de bin/jarvis en un Chromium NUEVO (sin la sesión de la herramienta) y dice si pasó.
// Uso: PW_CORE=<ruta a playwright-core> node replay.cjs <script.spec.ts>  → una línea JSON {ok, lineas, url, error}
const fs = require('fs')
const { chromium, devices } = require(process.env.PW_CORE)
const src = fs.readFileSync(process.argv[2], 'utf8')
const head = 'async ({ page }) => {'
const body = src.slice(src.indexOf(head) + head.length, src.lastIndexOf('})'))
// playwright-core no trae expect: lo justo para las aserciones que escribe la herramienta.
const expect = (loc) => ({
  toBeVisible: () => loc.waitFor({ state: 'visible', timeout: 15000 }),
  toHaveValue: async (v) => { const got = await loc.inputValue(); if (got !== v) throw new Error(`toHaveValue: tiene «${got}», se esperaba «${v}»`) },
})
// expect.poll(fn, { timeout }).toBe(v): repite fn hasta que dé v.
expect.poll = (fn, opts = {}) => ({
  toBe: async (v) => {
    const end = Date.now() + (opts.timeout || 5000)
    let last
    while (Date.now() < end) { last = await fn(); if (last === v) return; await new Promise((r) => setTimeout(r, 300)) }
    throw new Error(`expect.poll: dio ${last}, se esperaba ${v}`)
  },
})
const lineas = body.split('\n').filter((l) => l.trim().startsWith('await ')).length
;(async () => {
  const browser = await chromium.launch()
  // Un recorrido en el teléfono trae test.use({ ...devices['Pixel 7'] }): se repite con ese mismo perfil.
  const device = (src.match(/devices\['([^']+)'\]/) || [])[1]
  const page = await (await browser.newContext(device ? devices[device] : {})).newPage()
  page.setDefaultTimeout(15000)
  try {
    await new Function('page', 'expect', 'fs', 'return (async () => {' + body + '})()')(page, expect, require('fs'))
    console.log(JSON.stringify({ ok: true, lineas, url: page.url() }))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, lineas, url: page.url(), error: e.message.split('\n')[0] }))
  } finally {
    await browser.close()
  }
})()
