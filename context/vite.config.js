import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const MAX_REQUEST_BYTES = 10 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('too-large'))
        req.resume()
        return
      }
      raw += chunk
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('invalid-json')) }
    })
    req.on('error', () => reject(new Error('request-error')))
  })
}

function runTool(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [script, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let stdout = ''
    let overflow = false
    const timeout = setTimeout(() => child.kill(), 17_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_RESPONSE_BYTES) { overflow = true; child.kill() }
    })
    child.on('error', () => { clearTimeout(timeout); reject(new Error('unavailable')) })
    child.on('close', () => {
      clearTimeout(timeout)
      if (overflow) return reject(new Error('response-too-large'))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('unavailable')) }
    })
  })
}

function clientError(code) {
  const error = new Error(code)
  error.code = code
  error.status = 400
  return error
}


function nodeFrom(body) {
  const node = typeof body?.node === 'string' ? body.node.trim() : ''
  if (!/^[a-z0-9-]{1,80}$/.test(node)) throw clientError('invalid-node')
  return node
}



function derivaApi() {
  return {
    name: 'context-deriva-api',
    configureServer(server) {
      server.middlewares.use('/api/deriva', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
        try {
          const body = await readJson(req)
          return sendJson(res, 200, await runTool('tools/diff.py', [nodeFrom(body), '--json']))
        } catch (error) {
          // Nunca devolvemos stderr: puede traer rutas locales.
          return sendJson(res, error.status || 503, { error: error.code || 'deriva-no-disponible' })
        }
      })
    },
  }
}

// Viz read-only del árbol de contexto. Sin backend persistente: lee tree.json + los map.json/doc.md
// del repo vía import.meta.glob. El único endpoint local contesta «¿el cambio tocó lo que este nodo
// AFIRMA?» corriendo `tools/diff.py --json`, que es git y aritmética: no sale nada de esta máquina.
//
// ⚠ Acá vivía la consola de Jev (`route`/`brief`/`scope`/`review`) y el ruteo en vivo del buscador,
// que mandaba a un tercero lo que se tipeaba. Se retiraron el 2026-09-21: ninguno de los dos se usaba
// en el trabajo diario —`route` es para una tarea NUEVA y se corre por consola, `brief` lo consume
// `make retomar BRIEF=1`— y el que sí hacía falta acá era este, que no necesita modelo. Las cuatro
// capas siguen disponibles en `make context-jev ARGS='…'`.
export default defineConfig({
  plugins: [vue(), tailwindcss(), derivaApi()],
  server: { port: 5193 },
})
