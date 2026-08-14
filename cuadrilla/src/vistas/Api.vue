<script setup>
import Tokens from '../piezas/Tokens.vue'

/* La API es la única superficie para agentes. Se evaluó un server MCP y quedó descartado: credibrain
   ya es un MCP con `log_work` / `find_work`, y un segundo pondría dos juegos de herramientas para
   registrar trabajo en la misma lista del agente. */

const ENDPOINTS = [
  {
    metodo: 'GET', ruta: '/api/epicas',
    para: 'Todo el tablero: épicas, su gente, sus repos con la rama base, sus ramas y su documentación.',
    auth: 'abierto',
  },
  {
    metodo: 'GET', ruta: '/api/epicas/:id',
    para: 'Una épica. Es la primera llamada útil de un agente: trae lo que los demás ya documentaron.',
    auth: 'abierto',
  },
  {
    metodo: 'PUT', ruta: '/api/epicas/:id/docs',
    para: 'Escribir tu documentación (markdown). Reemplaza la anterior; vacío la borra.',
    cuerpo: '{ "texto": "## Qué hice\\n…\\n\\n## Ojo con esto\\n…" }',
    auth: 'token',
  },
  {
    metodo: 'POST', ruta: '/api/epicas/:id/ramas',
    para: 'Enganchar a la épica una rama que ya existe en origin, a tu nombre.',
    cuerpo: '{ "repo": "legacy-backend", "rama": "feat/…", "nota": "en qué trabajás" }',
    auth: 'token',
  },
  {
    metodo: 'DELETE', ruta: '/api/epicas/:id/ramas?repo=&rama=',
    para: 'Sacar una rama de la épica. No toca git: la rama sigue en origin.',
    auth: 'token',
  },
]
</script>

<template>
  <div class="doc">
    <h1>API</h1>
    <p class="sub">
      Cómo un agente lee el tablero y deja contexto sin que nadie toque la interfaz. Es la misma API
      que usa esta pantalla — no hay una versión aparte para agentes.
    </p>

    <Tokens />

    <!-- ── la idea que ordena todo ──────────────────────────────────────────────────────────── -->
    <h2>Lo que se deriva y lo que se declara</h2>
    <p>
      No existe un endpoint para <i>actualizar el progreso</i>, y no debería existir. El progreso
      sale de GitHub. Lo único que alguien —persona o agente— tiene que aportar es lo que GitHub no
      puede saber.
    </p>

    <div class="division">
      <div class="col">
        <h3>Lo derivado <i>nadie lo escribe</i></h3>
        <ul>
          <li>Las ramas que existen en <span class="mono">origin</span></li>
          <li>Si hay PR abierto, y si está aprobado o mergeado</li>
          <li>Cuántos días lleva abierto, y el <span class="mono">+/−</span></li>
          <li>Quién hizo el último commit</li>
        </ul>
      </div>
      <div class="col">
        <h3>Lo declarado <i>para esto es la API</i></h3>
        <ul>
          <li>Qué épica existe, en qué repos se toca y su rama base</li>
          <li>Qué rama pertenece a qué épica y de quién es</li>
          <li>En qué va a trabajar cada quien (la nota)</li>
          <li><b>La documentación</b>: lo aprendido y las trampas</li>
        </ul>
      </div>
    </div>

    <p class="remate">
      Un estado escrito a mano se desactualiza el primer día y a partir de ahí miente con cara de
      dato. Si un número se puede derivar, se deriva. <b>Hoy los estados son simulados</b> con
      <span class="mono">npm run simular</span>, y ese script se borra el día que exista la GitHub App.
    </p>

    <!-- ── auth ─────────────────────────────────────────────────────────────────────────────── -->
    <h2>Autenticación</h2>
    <p>Las lecturas son abiertas. Las escrituras aceptan dos caminos, con permisos distintos:</p>
    <ul class="razones">
      <li><b>Cookie de sesión</b> — una persona en el navegador. Puede escribir por otro: un lead
        ordenando la documentación de la épica es un caso real.</li>
      <li><b>Bearer token</b> — un agente. Solo escribe <b>como su dueño</b>. Si intenta escribir la
        documentación de otro, recibe un 403 explícito en vez de una escritura silenciosa en el lugar
        equivocado.</li>
    </ul>
    <p class="remate">
      Por eso el token es <b>por persona y no del equipo</b>: con uno compartido, cualquiera escribe
      como cualquiera y el campo «de quién es esta rama» deja de ser verificable — que es justo lo
      que este tablero existe para saber.
    </p>

    <!-- ── endpoints ────────────────────────────────────────────────────────────────────────── -->
    <h2>Los endpoints que necesita un agente</h2>
    <article v-for="e in ENDPOINTS" :key="e.metodo + e.ruta" class="ep">
      <p class="linea">
        <span class="metodo" :class="e.metodo.toLowerCase()">{{ e.metodo }}</span>
        <span class="ruta mono">{{ e.ruta }}</span>
        <span class="auth" :class="e.auth">{{ e.auth === 'abierto' ? 'sin auth' : 'token o sesión' }}</span>
      </p>
      <p class="para">{{ e.para }}</p>
      <pre v-if="e.cuerpo" class="mono">{{ e.cuerpo }}</pre>
    </article>

    <h2>Cómo se ve en una sesión</h2>
    <pre class="bloque mono">export CUADRILLA_TOKEN=cua_…            # el de arriba, una sola vez

# 1 · leer la épica: lo que los demás ya documentaron
curl -s localhost:5197/api/epicas/example

# 2 · …trabajar, crear la rama y pushearla…

# 3 · engancharla a la épica (queda a tu nombre, sale del token)
curl -X POST localhost:5197/api/epicas/example/ramas \
  -H "authorization: Bearer $CUADRILLA_TOKEN" \
  -H "content-type: application/json" \
  -d '{"repo":"legacy-backend","rama":"feat/mi-rama","nota":"el OTP"}'

# 4 · dejar la documentación (markdown)
curl -X PUT localhost:5197/api/epicas/example/docs \
  -H "authorization: Bearer $CUADRILLA_TOKEN" \
  -H "content-type: application/json" \
  -d '{"texto":"## Qué hice\n…\n\n## Ojo con esto\n…"}'

# El estado (PR, días, mergeada) nunca se toca: aparece solo.</pre>
    <p class="sub2">
      Fijate que en el paso 4 no va el nombre de la persona en la URL: sale del token. Es más corto
      <i>y</i> no se puede mentir sobre la autoría.
    </p>

  </div>
</template>

<style scoped>
.doc{max-width:78ch}
.sub{color:var(--page-soft);font-size:13.5px;margin:8px 0 0;line-height:1.65}
.sub2{color:var(--page-soft);font-size:12.5px;margin:9px 0 0;line-height:1.65}

h2{font-size:15px;font-weight:600;margin:34px 0 0;padding-top:18px;border-top:1px solid var(--line)}
h3{font-size:13px;font-weight:500;margin:0}
p{font-size:13.5px;line-height:1.7;color:var(--page-soft);margin:10px 0 0}
p b,li b{color:var(--page-ink);font-weight:500}
i{color:var(--page-tenue)}

.division{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));margin-top:14px}
.col{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:13px 15px}
.col h3 i{font-style:normal;font-size:11.5px;font-weight:400;margin-left:6px}
.col ul{margin:10px 0 0;padding-left:17px;font-size:12.5px;color:var(--page-soft);line-height:1.75}
.remate{margin-top:14px}
.razones{margin:12px 0 0;padding-left:18px;font-size:13px;color:var(--page-soft);line-height:1.7}
.razones li{margin-bottom:8px}

.ep{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px 14px;
  margin-top:9px}
.linea{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0}
.metodo{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:600;padding:1px 7px;
  border-radius:4px;border:1px solid currentColor}
.metodo.get{color:var(--ok)}
.metodo.put,.metodo.post{color:var(--accent)}
.metodo.delete{color:var(--bad)}
.ruta{font-size:12.5px;color:var(--page-ink);font-weight:500}
.auth{margin-left:auto;font-size:10.5px;color:var(--page-tenue)}
.auth.token{color:var(--warn)}
.para{font-size:12.5px;margin:7px 0 0}
.ep pre{margin:9px 0 0;font-size:11.5px;background:var(--soft-bg2);border-radius:6px;padding:8px 10px;
  overflow-x:auto;color:var(--page-soft)}

.bloque{margin:12px 0 0;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);
  padding:13px 15px;font-size:11.5px;line-height:1.75;color:var(--page-soft);
  white-space:pre-wrap;overflow-x:auto}
.antecedente{border-left:2px solid var(--line);padding-left:14px;margin-top:14px;font-size:13px}
</style>
