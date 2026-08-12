import { reactive } from 'vue'
import { PERSONAS } from './datos.js'

/* La sesión del navegador. Tres estados y hay que distinguirlos, porque se ven parecido y
   significan cosas muy distintas:

     sinServer     el server de sesión no responde — se está corriendo solo `vite`
     sinConfigurar el server anda pero no hay OAuth App cargada (falta el .env)
     sinEntrar     todo listo, la persona no entró todavía

   Si los tres mostraran «entrar con GitHub», el botón fallaría en silencio en dos de los tres. */
export const sesion = reactive({
  estado: 'cargando',   // cargando | sinServer | sinConfigurar | sinEntrar | dentro
  yo: null,             // { login, nombre, avatar }
  org: null,
  error: null,          // state | token | org, si GitHub nos devolvió con un problema
})

/* De `login` de GitHub a persona del tablero. Es el pago del login: hasta ahora había que adivinar
   si `mig-creditop` y `Miguel Ochoa` eran el mismo (y con los dos Josés no había forma de saberlo).
   Con OAuth, el `login` es exacto y el mapa se llena solo a medida que cada quien entra. */
export function personaDe(login){
  if (!login) return null
  const l = login.toLowerCase()
  return Object.keys(PERSONAS).find(id => (PERSONAS[id].github ?? []).some(g => g.toLowerCase() === l)) ?? null
}

export async function cargarSesion(){
  // El error viaja en la URL desde el redirect de GitHub; se limpia enseguida para que no quede
  // pegado en la barra ni se repita al recargar.
  const p = new URLSearchParams(location.search)
  if (p.get('error')) {
    sesion.error = p.get('error')
    history.replaceState({}, '', location.pathname)
  }

  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    sesion.org = cfg.org
    if (!cfg.configurado) { sesion.estado = 'sinConfigurar'; return }
    const yo = await fetch('/api/me').then(r => r.json())
    sesion.yo = yo
    sesion.estado = yo ? 'dentro' : 'sinEntrar'
  } catch {
    // Sin server no hay login, pero la app sigue: los datos son mock igual.
    sesion.estado = 'sinServer'
  }
}

/* La gente de la organización, para el selector al crear una épica. Se pide una vez por carga y se
   guarda acá: el server ya cachea, pero no hace falta ir hasta él cada vez que se abre el modal.

   `disponible:false` NO es un error a esconder: significa que hay que usar el roster local, y el
   formulario lo dice. Mostrar una lista vacía sin explicación es peor que mostrar la de mentira. */
export const miembros = reactive({ estado: 'sinPedir', lista: [], motivo: null })

export async function cargarMiembros(){
  if (miembros.estado === 'cargando' || miembros.estado === 'listo') return
  miembros.estado = 'cargando'
  try {
    const r = await fetch('/api/members').then(x => x.json())
    miembros.lista = r.miembros ?? []
    miembros.motivo = r.motivo ?? null
    miembros.estado = r.disponible ? 'listo' : 'noDisponible'
  } catch {
    miembros.estado = 'noDisponible'
    miembros.motivo = 'sinServer'
  }
}

// Los repos de la organización, misma mecánica que la gente.
export const repos = reactive({ estado: 'sinPedir', lista: [], motivo: null })

export async function cargarRepos(){
  if (repos.estado === 'cargando' || repos.estado === 'listo') return
  repos.estado = 'cargando'
  try {
    const r = await fetch('/api/repos').then(x => x.json())
    repos.lista = r.repos ?? []
    repos.motivo = r.motivo ?? null
    repos.estado = r.disponible ? 'listo' : 'noDisponible'
  } catch {
    repos.estado = 'noDisponible'
    repos.motivo = 'sinServer'
  }
}

/* Las ramas de un repo, bajo demanda y memorizadas por repo. Devuelve `null` cuando no se pudieron
   traer, para que quien llama sepa que tiene que usar la lista local en vez de mostrar nada. */
const ramasPorRepo = reactive({})

export function ramasDeRepo(repo){
  return ramasPorRepo[repo] ?? null
}

export async function cargarRamas(repo){
  if (ramasPorRepo[repo] !== undefined) return
  ramasPorRepo[repo] = null
  try {
    const r = await fetch(`/api/branches?repo=${encodeURIComponent(repo)}`).then(x => x.json())
    ramasPorRepo[repo] = r.disponible && r.ramas.length ? r.ramas : null
  } catch {
    ramasPorRepo[repo] = null
  }
}

export const entrar = () => { location.href = '/api/login' }

export async function salir(){
  await fetch('/api/logout', { method: 'POST' })
  sesion.yo = null
  sesion.estado = 'sinEntrar'
}
