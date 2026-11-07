// Un Chromium con la extensión del navegador cargada, en lugar del Chrome de la persona: para probar el puente
// (server/chrome.go) sin ella. Usa el playwright-core que ya armó el servidor (driver.go).
//
//   node navegador/dev/chrome-stand-in.cjs                       la extensión conectada a :5203
//   SHARE_URL=http://127.0.0.1:5207/ node navegador/dev/…        además abre esa página y la «comparte»
//
// Después: bin/navegador chrome · bin/navegador empezar --chrome --url … '<meta>'. Se corta con Ctrl-C.
const os = require('os'), fs = require('fs'), path = require('path')
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go')
const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()
const { chromium } = require(path.join(cache, version, 'package'))
const ext = process.argv[2] || path.join(__dirname, '..', 'extension')
;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-ext-'))
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  })
  // Playwright rechaza solo los diálogos que nadie escucha: un escuchador vacío lo deja en manos del navegador,
  // como en un Chrome sin Playwright.
  const quiet = (p) => p.on('dialog', () => {})
  ctx.pages().forEach(quiet)
  ctx.on('page', quiet)
  let [sw] = ctx.serviceWorkers()
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
  console.log('service worker:', sw.url())
  for (let i = 0; i < 30; i++) {
    const st = await (await fetch('http://127.0.0.1:5203/api/chrome')).json()
    if (st.connected) { console.log('conectada:', JSON.stringify(st)); break }
    await new Promise(r => setTimeout(r, 500))
  }
  if (process.env.SHARE_URL) {
    // Como si la persona abriera esa página y tocara «Compartir con el navegador» en el panel lateral.
    const p = await ctx.newPage()
    await p.goto(process.env.SHARE_URL)
    const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url.startsWith(u)).id, process.env.SHARE_URL)
    await sw.evaluate((id) => share(id), id)
    console.log('compartida la pestaña', id)
  }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await ctx.close(); process.exit(0) })
  setInterval(() => {}, 1 << 30)
})().catch(e => { console.error(e); process.exit(1) })
