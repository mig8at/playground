import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const MAX_REQUEST_BYTES = 10 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_SCOPE_FILES = 3
const SENSITIVE_LIKE = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b\d[\d\s-]{4,}\d\b|\b(?:sk|ts|api|key)_[A-Za-z0-9_-]{12,}\b|\b(?:api[-_ ]?key|token|secret|password|contraseña)\s*[:=]\s*\S{6,}|\bbearer\s+[A-Za-z0-9._-]{12,}/i

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

function runJev(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['tools/jev.py', ...args], {
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

function queryFrom(body) {
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query || query.length > 2000) throw clientError('invalid-query')
  if (SENSITIVE_LIKE.test(query)) throw clientError('sensitive-query')
  return query
}

function nodeFrom(body) {
  const node = typeof body?.node === 'string' ? body.node.trim() : ''
  if (!/^[a-z0-9-]{1,80}$/.test(node)) throw clientError('invalid-node')
  return node
}

function filesFrom(body, required = false) {
  const files = Array.isArray(body?.files) ? [...new Set(body.files)] : []
  if ((required && !files.length) || files.length > MAX_SCOPE_FILES ||
      files.some((file) => typeof file !== 'string' || !/^[a-z0-9-]+\/[\w./+-]{1,500}$/.test(file))) {
    throw clientError('invalid-scope')
  }
  return files
}

function argsFor(action, body) {
  if (action === 'route') {
    const query = queryFrom(body)
    return ['route', '--live', '--no-save', '--', query]
  }
  const node = nodeFrom(body)
  if (action === 'brief') return ['brief', node]
  const files = filesFrom(body, true)
  const fileArgs = files.flatMap((file) => ['--file', file])
  if (action === 'scope') return ['scope', node, ...fileArgs]
  if (action === 'review') return ['review', '--live', '--node', node, ...fileArgs, '--', queryFrom(body)]
  throw clientError('unknown-action')
}

function jevPreviewApi() {
  return {
    name: 'context-jev-console-api',
    configureServer(server) {
      for (const action of ['route', 'brief', 'scope', 'review']) server.middlewares.use(`/api/jev/${action}`, async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
        try {
          const body = await readJson(req)
          return sendJson(res, 200, await runJev(argsFor(action, body)))
        } catch (error) {
          // Nunca devolvemos stderr: puede contener detalles locales o el texto de la consulta.
          return sendJson(res, error.status || 503, { error: error.code || 'jev-unavailable' })
        }
      })
    },
  }
}

// Viz read-only del árbol de contexto. Sin backend persistente: lee tree.json + los map.json/doc.md
// del repo vía import.meta.glob. Estos endpoints locales preparan fichas y scopes efímeros de Jev:
// la clave se queda en el proceso de Vite, y el código sale sólo de archivos declarados y versionados.
export default defineConfig({
  plugins: [vue(), tailwindcss(), jevPreviewApi()],
  server: { port: 5193 },
})
