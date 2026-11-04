// El Shopify falso de la Store demo, publicado en el playground con nombre (`shopify.<tu usuario>.com`), para que el host
// de la app —que corre en la máquina de otra persona— le avise cuando un pago se resuelve. Lo arranca `npm run dev` al
// lado de la API y la interfaz; no hay que escribir ningún services.json ni correr nada aparte.
//
// Usa el CLI del playground (`playground serve`) con la sesión de quien lo corre. Si el CLI no está instalado o no hay
// sesión, NO corta `npm run dev`: deja dicho qué falta (la pestaña Conexiones lo muestra) y vuelve a probar cada 15 s, así
// alcanza con instalarlo o hacer `playground login` en otra terminal.
//
// Lo que pasa queda en `.data/shopify-share.json` —{ state, name, url, hint, at }—, que lee el servidor (shopify_demo.go).
// `state`: starting · no-cli · no-session · serving · stopped.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, '.data')
const STATUS = join(DATA, 'shopify-share.json')
const SERVICES = join(DATA, 'shopify-share-services.json')
const RETRY_MS = 15_000
// Lo que se publica: SÓLO el Shopify falso de este servidor (server/shopify_demo.go escucha en 127.0.0.1:5187).
const SERVICE = { alias: 'shopify', to: 'http://127.0.0.1:5187', description: 'Shopify falso de la Store demo (ecommerce-v2)' }

// El playground contra el que se publica: SHOPIFY_DEMO_PLAYGROUND del .env (el proceso gana), o el de producción.
function envValue(key) {
  if (process.env[key]) return process.env[key]
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.trim().replace(/^export\s+/, '').match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* sin .env */ }
  return ''
}
const BASE = (envValue('SHOPIFY_DEMO_PLAYGROUND') || 'https://playground.creditop.com').replace(/\/$/, '')

mkdirSync(DATA, { recursive: true })
const report = (state, extra = {}) => {
  writeFileSync(STATUS, JSON.stringify({ state, playground: BASE, at: new Date().toISOString(), ...extra }, null, 2))
  console.log(`share · ${state}${extra.name ? ` · ${extra.name}` : ''}${extra.hint ? ` · ${extra.hint}` : ''}`)
}

// El CLI: el `playground` instalado, o PLAYGROUND_CLI (un playground.js, para probar una versión que todavía no se
// desplegó). Devuelve [comando, ...argumentos fijos] o null.
const cliPath = () => {
  if (process.env.PLAYGROUND_CLI) return [process.execPath, process.env.PLAYGROUND_CLI]
  const r = spawnSync('sh', ['-c', 'command -v playground'], { encoding: 'utf8' })
  return r.status === 0 ? [r.stdout.trim()] : null
}
// ¿El CLI instalado ya sabe servir? Uno viejo (de antes de `playground serve`) se reconoce por su ayuda.
const knowsServe = ([cmd, ...pre]) => /playground serve/.test(spawnSync(cmd, [...pre, 'help'], { encoding: 'utf8' }).stdout || '')
function hasSession([cmd, ...pre]) {
  const r = spawnSync(cmd, [...pre, '--url', BASE, 'whoami', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 })
  try { return r.status === 0 && JSON.parse(r.stdout).autenticado === true ? JSON.parse(r.stdout) : null } catch { return null }
}

let child = null
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill('SIGTERM'); process.exit(0) })

function attempt() {
  const cli = cliPath()
  if (!cli) {
    report('no-cli', { hint: `instalá el CLI del playground: curl -fsSL ${BASE}/cli/install | sh` })
    return setTimeout(attempt, RETRY_MS)
  }
  if (!knowsServe(cli)) {
    report('no-cli', { hint: `tu CLI del playground es viejo y no sabe servir: playground update` })
    return setTimeout(attempt, RETRY_MS)
  }
  const me = hasSession(cli)
  if (!me) {
    report('no-session', { hint: `entrá al playground: playground login${BASE === 'https://playground.creditop.com' ? '' : ` --url ${BASE}`}` })
    return setTimeout(attempt, RETRY_MS)
  }
  writeFileSync(SERVICES, JSON.stringify([SERVICE], null, 2))
  report('starting', { email: me.correo })
  const [cmd, ...pre] = cli
  child = spawn(cmd, [...pre, '--url', BASE, 'serve', '--json'], { env: { ...process.env, PLAYGROUND_SERVICES_FILE: SERVICES }, stdio: ['ignore', 'pipe', 'pipe'] })
  let published = false
  let rest = ''
  child.stdout.setEncoding('utf8').on('data', chunk => {
    rest += chunk
    let i
    while ((i = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, i).trim()
      rest = rest.slice(i + 1)
      if (!published && line.startsWith('[')) {
        try {
          const [s] = JSON.parse(line)
          published = true
          report('serving', { name: s.name, url: s.url, email: me.correo })
        } catch { /* no era la lista */ }
      }
    }
  })
  let errText = ''
  child.stderr.setEncoding('utf8').on('data', d => { errText = (errText + d).slice(-500); process.stderr.write(`share · ${d}`) })
  child.on('exit', code => {
    child = null
    report('stopped', { hint: `playground serve terminó (${code ?? 'señal'}): ${errText.trim().split('\n').at(-1) || 'sin detalle'} · reintento en ${RETRY_MS / 1000} s` })
    setTimeout(attempt, RETRY_MS)
  })
}

report('starting')
attempt()
