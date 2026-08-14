import { randomBytes } from 'node:crypto'

/* ═══ IMPOSTOR ══════════════════════════════════════════════════════════════════════════════════
   El juego de la palabra impostora, para la oficina. Todos reciben la MISMA palabra menos uno, que
   recibe la del par —«café» contra «té»—. Se dan pistas en un chat y después se vota quién es el
   raro. Al revelar se muestran las dos palabras.

   El impostor NO sabe que lo es: se entera porque las pistas de los demás no le cierran. Es la
   variante que genera el juego solo, sin que nadie tenga que actuar.

   ── Estado en MEMORIA, a diferencia del resto de la app ──────────────────────────────────────
   Una partida dura minutos y no le sirve a nadie mañana. Guardarla en SQLite sería tener que
   limpiarla, migrarla y versionarla para nada. Si el server se reinicia, la partida se corta: es
   el precio correcto para esto y no para las épicas.                                             */

const PARES = [
  ['café', 'té'], ['pizza', 'empanada'], ['playa', 'piscina'], ['perro', 'gato'],
  ['avión', 'tren'], ['guitarra', 'piano'], ['lluvia', 'niebla'], ['reloj', 'calendario'],
  ['ascensor', 'escalera'], ['almuerzo', 'merienda'], ['bicicleta', 'moto'], ['sal', 'azúcar'],
  // De la casa: entran a propósito, son las que van a generar las mejores pistas en esta oficina.
  ['desembolso', 'abono'], ['rama', 'commit'], ['sprint', 'backlog'], ['staging', 'producción'],
  ['buró', 'scoring'], ['cuota', 'plazo'], ['OTP', 'contraseña'], ['merge', 'rebase'],
]

/* Una sola sala. Para una oficina alcanza —el juego es «los que estamos ahora»— y evita el trámite
   de crear, compartir y equivocarse de código de sala. */
const sala = {
  fase: 'lobby',            // lobby | pistas | votando | revelado
  jugadores: new Map(),     // id → { id, nombre, palabra, impostor, voto, conectado }
  pistas: [],
  par: null,
  ronda: 0,
}

const clientes = new Set()  // { id, res } — una conexión SSE por jugador

const nuevoId = () => randomBytes(6).toString('hex')
const mezclar = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1])

/* Lo que ve TODO el mundo. Nunca incluye `palabra` ni `impostor`: si el estado público llevara la
   palabra de cada uno, el juego se termina abriendo las herramientas del navegador. */
function publico(){
  return {
    fase: sala.fase,
    ronda: sala.ronda,
    jugadores: [...sala.jugadores.values()].map(j => ({
      id: j.id, nombre: j.nombre, conectado: j.conectado, voto: sala.fase === 'revelado' ? j.voto : null,
      yaVoto: Boolean(j.voto),
    })),
    pistas: sala.pistas,
    // El resultado solo existe una vez revelado.
    resultado: sala.fase === 'revelado' ? resultado() : null,
  }
}

function resultado(){
  const jugadores = [...sala.jugadores.values()]
  const impostor = jugadores.find(j => j.impostor)
  const conteo = new Map()
  for (const j of jugadores) if (j.voto) conteo.set(j.voto, (conteo.get(j.voto) ?? 0) + 1)
  const masVotado = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    impostor: impostor ? { id: impostor.id, nombre: impostor.nombre } : null,
    palabras: sala.par ? { grupo: sala.par[0], impostor: sala.par[1] } : null,
    votos: [...conteo.entries()].map(([id, n]) => ({ id, n })),
    acerto: Boolean(masVotado && impostor && masVotado[0] === impostor.id),
  }
}

function mandar(res, evento, datos){
  res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)
}

// El estado público a todos, y a cada uno SU palabra por separado. Dos mensajes distintos y no uno
// filtrado en el front: lo que no sale del server no se puede espiar.
function difundir(){
  const pub = publico()
  for (const c of clientes) {
    mandar(c.res, 'sala', pub)
    const j = sala.jugadores.get(c.id)
    if (j) mandar(c.res, 'tuPalabra', { palabra: j.palabra ?? null })
  }
}

export function entrar(nombre){
  const id = nuevoId()
  sala.jugadores.set(id, {
    id, nombre: (nombre ?? '').trim().slice(0, 24) || 'anónimo',
    palabra: null, impostor: false, voto: null, conectado: false,
  })
  difundir()
  return { id, sala: publico() }
}

export function salir(id){
  sala.jugadores.delete(id)
  if (sala.jugadores.size === 0) reiniciar()
  else difundir()
}

export function arrancar(){
  const jugadores = [...sala.jugadores.values()]
  if (jugadores.length < 3) return { error: 'hacen falta 3 jugadores para que el juego tenga sentido' }

  sala.par = mezclar(PARES)[0]
  const [grupo, otra] = mezclar(sala.par)   // cuál de las dos toca al grupo también se sortea
  sala.par = [grupo, otra]

  const elegido = mezclar(jugadores)[0]
  for (const j of jugadores) {
    j.impostor = j.id === elegido.id
    j.palabra = j.impostor ? otra : grupo
    j.voto = null
  }
  sala.pistas = []
  sala.fase = 'pistas'
  sala.ronda++
  difundir()
  return { ok: true }
}

export function pista(id, texto){
  const j = sala.jugadores.get(id)
  if (!j) return { error: 'no estás en la sala' }
  if (sala.fase !== 'pistas') return { error: 'no es momento de dar pistas' }
  const t = (texto ?? '').trim().slice(0, 120)
  if (!t) return { error: 'pista vacía' }
  sala.pistas.push({ de: j.nombre, deId: j.id, texto: t })
  difundir()
  return { ok: true }
}

export const aVotar = () => {
  if (sala.fase !== 'pistas') return { error: 'todavía no' }
  sala.fase = 'votando'
  difundir()
  return { ok: true }
}

export function votar(id, aQuien){
  const j = sala.jugadores.get(id)
  if (!j || sala.fase !== 'votando') return { error: 'no se puede votar ahora' }
  if (!sala.jugadores.has(aQuien)) return { error: 'ese jugador no existe' }
  j.voto = aQuien
  // Se revela solo cuando votaron todos: revelar antes deja al último sin poder jugar.
  if ([...sala.jugadores.values()].every(x => x.voto)) sala.fase = 'revelado'
  difundir()
  return { ok: true }
}

export function reiniciar(){
  sala.fase = 'lobby'
  sala.pistas = []
  sala.par = null
  for (const j of sala.jugadores.values()) { j.palabra = null; j.impostor = false; j.voto = null }
  difundir()
  return { ok: true }
}

/* ── el stream ────────────────────────────────────────────────────────────────────────────────
   `x-accel-buffering: no` y el latido cada 20s son lo que mantiene la conexión viva: sin datos
   fluyendo, un proxy en el medio la cierra a los pocos minutos y el chat se congela sin error. */
export function suscribir(req, res, id){
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write('retry: 2000\n\n')

  const cliente = { id, res }
  clientes.add(cliente)
  const j = sala.jugadores.get(id)
  if (j) j.conectado = true

  mandar(res, 'sala', publico())
  if (j) mandar(res, 'tuPalabra', { palabra: j.palabra ?? null })
  difundir()

  const latido = setInterval(() => res.write(': latido\n\n'), 20_000)

  req.on('close', () => {
    clearInterval(latido)
    clientes.delete(cliente)
    const jj = sala.jugadores.get(id)
    // Se marca desconectado pero NO se lo saca: recargar la página no debería echarte de la partida.
    if (jj && ![...clientes].some(c => c.id === id)) jj.conectado = false
    difundir()
  })
}

export const estado = () => publico()
