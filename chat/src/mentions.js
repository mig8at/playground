/* MENCIONES EN LOS GRUPOS. Una mención es texto, como en `playground send`: `@usuario` (la parte del correo antes de
   la @), `@usuario/agente` para el agente de alguien, o `@todos`. El CLI no las conoce: viajan dentro del
   mensaje y es esta app la que las autocompleta al escribir, las resalta y avisa cuando te nombran. */

export const EVERYONE = 'todos'

// La mención: precedida de inicio o de algo que no sea parte de un correo (así `ana@creditop.com` no cuenta).
const TOKEN = /(^|[^\w@./-])@([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)/gi
// Un punto o un guion al final es puntuación de la frase («gracias @duncan.»), no del usuario.
const trimTail = (h) => h.replace(/[._-]+$/, '')

// El usuario de un miembro del grupo: `duncan.estrada@creditop.com` → `duncan.estrada`; `…/rambo` → `duncan.estrada/rambo`.
export function handleOf(member) {
  const [email, agent] = String(member || '').toLowerCase().split('/')
  const user = email.split('@')[0]
  return agent ? `${user}/${agent}` : user
}

export function mentionsIn(text) {
  const out = []
  for (const m of String(text || '').matchAll(TOKEN)) out.push(trimTail(m[2]).toLowerCase())
  return out
}

// ¿Te nombra? Por tu usuario, por uno de tus agentes (`miguel/jira`) o con `@todos`.
export function mentionsMe(text, myUser, myAgents = []) {
  if (!myUser) return false
  const mine = new Set([myUser.toLowerCase(), EVERYONE, ...myAgents.map((a) => `${myUser}/${a}`.toLowerCase())])
  return mentionsIn(text).some((h) => mine.has(h))
}

/* El texto en pedazos para pintarlo: los que son una mención a alguien del grupo (o `@todos`) se resaltan; `me` marca
   las que te nombran. Lo que no es de nadie del grupo queda como texto. */
export function segments(text, known, myUser, myAgents = []) {
  const s = String(text || '')
  const mine = new Set([String(myUser || '').toLowerCase(), EVERYONE, ...myAgents.map((a) => `${myUser}/${a}`.toLowerCase())])
  const out = []
  let last = 0
  for (const m of s.matchAll(TOKEN)) {
    const handle = trimTail(m[2])
    const key = handle.toLowerCase()
    if (!known.has(key) && key !== EVERYONE) continue
    const at = m.index + m[1].length
    if (at > last) out.push({ text: s.slice(last, at) })
    out.push({ text: `@${handle}`, mention: key, me: mine.has(key) })
    last = at + 1 + handle.length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

// Lo que se está escribiendo como mención: la @ antes del cursor y lo que va después, si todavía es un usuario.
export function activeQuery(text, caret) {
  const before = String(text || '').slice(0, caret)
  const m = before.match(/(^|[^\w@./-])@([a-z0-9._/-]*)$/i)
  if (!m) return null
  return { start: before.length - m[2].length - 1, query: m[2].toLowerCase() }
}

/* Los candidatos para el menú: los miembros del grupo (menos vos) y `@todos`, filtrados por lo que se escribió en el
   usuario o en el nombre. Primero los que empiezan así. */
export function candidates(members, query, nameOf, myUser) {
  const q = String(query || '').toLowerCase()
  const rows = members
    .map((m) => {
      const handle = handleOf(m)
      const agent = handle.includes('/')
      return { handle, agent, label: agent ? `${handle.split('/')[1]} · agente de ${nameOf(String(m).split('/')[0])}` : nameOf(String(m)) }
    })
    .filter((r) => r.handle !== String(myUser || '').toLowerCase())
  rows.push({ handle: EVERYONE, agent: false, label: 'todo el grupo' })
  const score = (r) => {
    const name = r.label.toLowerCase()
    if (r.handle.startsWith(q)) return 0
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1
    if (r.handle.includes(q) || name.includes(q)) return 2
    return -1
  }
  return rows.map((r) => ({ ...r, score: score(r) })).filter((r) => r.score >= 0).sort((a, b) => a.score - b.score).slice(0, 8)
}
