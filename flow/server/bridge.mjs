// El canal entre `bin/flow` (la CLI) y la app abierta (2026-11-25). Flow guarda su escenario en el navegador de cada
// ventana, así que la CLI no escribe estado: le MANDA COMANDOS a las apps conectadas (la de Cockpit, sobre todo), que
// los aplican con la misma lógica de la interfaz y contestan. Vive dentro del servidor de Vite (:5252), sin proceso
// aparte.
//
//   GET  /api/events          la app se suscribe (SSE) y recibe { id, commands }
//   POST /api/commands        la CLI manda { commands: [...] } y espera hasta 15 s la respuesta de las apps
//   POST /api/ack             la app contesta { id, results }
//   POST /api/report          la app cuenta qué tiene (entidades, la elegida), después de cada guardado
//   GET  /api/report          la CLI lo lee (`bin/flow status`)
import { randomUUID } from 'node:crypto'

export function flowBridge() {
  const clients = new Set()          // respuestas SSE abiertas
  const pending = new Map()          // id → { resolve, results: [] , expected }
  const reports = new Map()          // app (id de su conexión) → lo último que contó; se borra al cerrarse

  const json = (res, code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
  const readBody = (req) => new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve(null) } })
  })

  return {
    name: 'flow-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith('/api/')) return next()

        if (url === '/api/events' && req.method === 'GET') {
          const appId = new URL(req.url, 'http://x').searchParams.get('app') || randomUUID()
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          res.write(': flow\n\n')
          clients.add(res)
          const ping = setInterval(() => res.write(': ping\n\n'), 20000)
          req.on('close', () => { clearInterval(ping); clients.delete(res); reports.delete(appId) })
          return
        }

        if (url === '/api/commands' && req.method === 'POST') {
          const body = await readBody(req)
          if (!body || !Array.isArray(body.commands) || !body.commands.length) return json(res, 400, { error: 'falta { commands: [...] }' })
          if (!clients.size) return json(res, 409, { error: 'no hay ninguna app de Flow abierta (bin/cockpit ensure flow)' })
          const id = randomUUID()
          const done = new Promise((resolve) => pending.set(id, { resolve, results: [], expected: clients.size }))
          const msg = `data: ${JSON.stringify({ id, commands: body.commands })}\n\n`
          for (const c of clients) c.write(msg)
          const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 15000))
          const outcome = await Promise.race([done, timeout])
          const entry = pending.get(id); pending.delete(id)
          return json(res, 200, { id, apps: entry.expected, answered: entry.results.length, timedOut: outcome === 'timeout', results: entry.results })
        }

        if (url === '/api/ack' && req.method === 'POST') {
          const body = await readBody(req)
          const entry = body && pending.get(body.id)
          if (entry) {
            entry.results.push(body.results || [])
            if (entry.results.length >= entry.expected) entry.resolve('ok')
          }
          return json(res, 200, { ok: true })
        }

        if (url === '/api/report') {
          if (req.method === 'POST') { const body = await readBody(req); if (body && body.app) reports.set(body.app, { ...body, at: new Date().toISOString() }); return json(res, 200, { ok: true }) }
          // Sólo lo de las apps CONECTADAS, la más reciente primero: una ventana cerrada no cuenta.
          const live = [...reports.values()].sort((a, b) => b.at.localeCompare(a.at))
          return json(res, 200, { apps: clients.size, report: live[0] || null, reports: live })
        }

        return json(res, 404, { error: 'no existe ' + url })
      })
    },
  }
}
