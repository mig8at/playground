// Escenario de Jarvis: dos sesiones en Chrome a la vez, el grupo «Jarvis», traer al frente la pestaña donde actúa
// Claude, cerrar una a mano (termina su sesión) y soltar el depurador al final. Deja una foto de la pestaña Jarvis.
// Necesita `make jarvis` arriba y nada más conectado como Jarvis.
//
//   node jarvis/dev/jarvis-dos-sesiones.cjs [carpeta para la foto]
const os = require('os'), fs = require('fs'), path = require('path')
const { execFile } = require('child_process')
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go')
const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()
const { chromium } = require(path.join(cache, version, 'package'))
const ROOT = path.join(__dirname, '..', '..')
const ext = path.join(ROOT, 'jarvis/extension')
// Asincrónico a propósito: este proceso también maneja el Chromium de prueba, y Chromium deja cada pestaña nueva en
// pausa hasta que su Playwright la suelte; una llamada sincrónica lo bloquea y se esperan uno al otro.
const nav = (env, ...args) => new Promise((resolve) => {
  execFile(path.join(ROOT, 'bin/jarvis'), args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 }, (err, stdout, stderr) => {
    resolve(err ? 'ERROR ' + String(err.message).split('\n')[0] + ' | ' + (stdout || '').slice(-200) + (stderr || '').slice(-300) : stdout)
  }).stdin.end()
})
const api = async (p) => (await fetch('http://127.0.0.1:5203' + p)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const first = (s) => s.split('\n').find((l) => /^[✓✗]|ERROR|sesión abierta|navegador:/.test(l)) || s.split('\n')[0]

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-2s-'))
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] })
  const quiet = (p) => p.on('dialog', () => {})
  ctx.pages().forEach(quiet); ctx.on('page', quiet)
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker')
  for (let i = 0; i < 40 && !(await api('/api/chrome')).connected; i++) await sleep(500)
  console.log('Jarvis conectado:', (await api('/api/chrome')).connected)

  const mine = await ctx.newPage(); await mine.goto('http://localhost:5202/') // una pestaña de la persona, sin compartir
  console.log('A:', first(await nav({}, 'empezar', '--chrome', '--url', 'http://127.0.0.1:5207/?restaurar', 'A: tareas')))
  const tabsA = await api('/api/tabs'); const A = tabsA.find((t) => t.device === 'chrome' && t.url.includes(':5207'))
  console.log('B:', first(await nav({}, 'empezar', '--chrome', '--url', 'http://127.0.0.1:5206/?restaurar', 'B: panel andino')))
  const tabs = await api('/api/tabs'); const B = tabs.find((t) => t.device === 'chrome' && t.url.includes(':5206'))
  console.log('sesiones en chrome:', tabs.filter((t) => t.device === 'chrome').map((t) => `${t.id}→chrome ${t.chromeTab} (${t.meta || t.url})`).join(' · '))

  const groups = await sw.evaluate(async () => (await chrome.tabGroups.query({})).map((g) => `${g.title}/${g.color}`))
  const grouped = await sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => t.groupId !== -1).length)
  console.log('grupos:', groups, '· pestañas en el grupo:', grouped)

  const active = async () => sw.evaluate(async () => (await chrome.tabs.query({ active: true })).map((t) => t.id)[0])
  console.log('A actúa:', first(await nav({ JARVIS_SESION: A.id }, 'check', '3')), '· activa', await active(), 'esperada', A.chromeTab)
  console.log('B actúa:', first(await nav({ JARVIS_SESION: B.id }, 'look')).slice(0, 40), '· activa', await active(), 'esperada', B.chromeTab)
  console.log('A actúa:', first(await nav({ JARVIS_SESION: A.id }, 'uncheck', '3')), '· activa', await active(), 'esperada', A.chromeTab)

  // La pestaña Jarvis con las dos sesiones.
  const id = new URL(sw.url()).host
  const control = await ctx.newPage()
  await control.setViewportSize({ width: 1200, height: 900 })
  await control.goto(`chrome-extension://${id}/control.html`)
  await control.waitForTimeout(3000)
  await control.screenshot({ path: path.join(process.argv[2] || os.tmpdir(), 'jarvis-control.png'), fullPage: true })
  console.log('foto de la pestaña Jarvis:', path.join(process.argv[2] || os.tmpdir(), 'jarvis-control.png'))

  // La persona cierra a mano la pestaña de B.
  await sw.evaluate((id) => chrome.tabs.remove(id), B.chromeTab)
  await sleep(3000)
  const after = await api('/api/tabs')
  const b2 = after.find((t) => t.id === B.id)
  console.log('B después de cerrar su pestaña en Chrome: sesión activa =', b2 && b2.active)
  console.log('A sigue:', first(await nav({ JARVIS_SESION: A.id }, 'check', '3')))

  await nav({ JARVIS_SESION: A.id }, 'terminar', 'NO PUDE: escenario de prueba de dos sesiones')
  await nav({ JARVIS_SESION: B.id }, 'terminar', 'NO PUDE: escenario de prueba de dos sesiones')
  await nav({ JARVIS_SESION: A.id }, 'close')
  await sleep(2500)
  const st = await api('/api/chrome')
  console.log('al final: enganchadas', st.attached.length, '· Playwright conectado', st.driving)
  await ctx.close()
})().catch((e) => { console.error(e); process.exit(1) })
