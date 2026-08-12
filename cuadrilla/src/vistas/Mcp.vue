<script setup>
/* Página de documentación. NO hay server: esto es el contrato propuesto, escrito antes de
   construirlo para poder discutirlo. Cada afirmación sobre lo que "hace" va en condicional. */

// Las tools. `deriva` marca lo que el server saca solo de GitHub y por eso NO se pide por parámetro.
const TOOLS = [
  {
    nombre: 'cuadrilla_epicas',
    para: 'Ver en qué anda el equipo. Es la primera llamada de cualquier sesión.',
    params: '—',
    devuelve: `[{ id, nombre, base, repos[], devs[],
   avance: { pct, mergeadas, total },
   esperando: { n, masDias } }]`,
  },
  {
    nombre: 'cuadrilla_epica',
    para: 'El detalle: ramas de cada quien, su estado, y lo que dejaron documentado.',
    params: 'id',
    devuelve: `{ id, nombre, base, repos[], devs[],
  ramas: [{ rama, repo, autor, estado, dias, pr, mas, men, base, nota }],
  docs:  { <quien>: { texto, trampa, dias } } }`,
  },
  {
    nombre: 'cuadrilla_crear_epica',
    para: 'Abrir el frente: nombre, quiénes, en qué repos y desde qué rama sale todo el mundo.',
    params: 'nombre, devs[], repos[], base',
    devuelve: '{ id }',
  },
  {
    nombre: 'cuadrilla_agregar_rama',
    para: 'Enganchar una rama que ya existe en origin a una épica, a nombre de alguien.',
    params: 'epica, repo, rama, quien, base?, nota?',
    devuelve: '{ ok, rama }',
    ojo: 'Falla si la rama no está en origin. No crea ramas: eso es trabajo de git, no del tablero.',
  },
  {
    nombre: 'cuadrilla_documentar',
    para: 'Dejar el contexto de lo trabajado para el resto de la cuadrilla. Reemplaza lo anterior.',
    params: 'epica, quien, texto, trampa?',
    devuelve: '{ ok }',
    ojo: 'Es el que más le sirve a un agente: al cerrar una tarea, escribe acá lo que aprendió.',
  },
  {
    nombre: 'cuadrilla_revision',
    para: 'Qué está frenando al equipo, cruzando épicas y ordenado por antigüedad.',
    params: 'diasMin?',
    devuelve: '[{ rama, repo, autor, dias, pr, epica }]',
  },
]
</script>

<template>
  <div class="doc">
    <h1>MCP</h1>
    <p class="sub">
      Cómo un agente usaría cuadrilla sin que nadie toque la interfaz: leer el estado del equipo y
      dejar contexto, desde la misma sesión en la que está trabajando.
    </p>

    <p class="aviso">
      <b>Esto no existe todavía.</b> Es el contrato escrito antes de construirlo, para poder
      discutirlo. No hay server, no hay endpoint, y ninguna de estas llamadas responde.
    </p>

    <!-- ── la idea que ordena todo ──────────────────────────────────────────────────────────── -->
    <h2>Lo que se deriva y lo que se declara</h2>
    <p>
      Pediste no tener que <i>actualizar el progreso</i> a mano. La respuesta no es una tool para
      hacerlo más cómodo: es que <b>el progreso no se escribe</b>. Sale de GitHub. Lo único que
      alguien —persona o agente— tiene que aportar es lo que GitHub no puede saber.
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
        <h3>Lo declarado <i>para esto son las tools</i></h3>
        <ul>
          <li>Qué épica existe, en qué repos se toca y su rama base</li>
          <li>Qué rama pertenece a qué épica y de quién es</li>
          <li>En qué va a trabajar cada quien (la nota)</li>
          <li><b>La documentación</b>: lo aprendido, y las trampas</li>
        </ul>
      </div>
    </div>

    <p class="remate">
      Por eso <b>no hay una tool <span class="mono">cuadrilla_actualizar_estado</span></b>, y no
      debería haberla. Un estado escrito a mano se desactualiza el primer día y a partir de ahí
      miente con cara de dato. Si un número se puede derivar, se deriva.
    </p>

    <!-- ── api o mcp ────────────────────────────────────────────────────────────────────────── -->
    <h2>¿API o MCP?</h2>
    <p>
      Preguntaste cuál conviene. <b>Las dos, pero en orden</b>: una API HTTP como fuente de verdad y
      un server MCP delgado encima, que solo traduzca llamadas.
    </p>
    <ul class="razones">
      <li><b>La API la va a necesitar la app igual.</b> Hoy la Vue lee de
        <span class="mono">src/datos.js</span>; el día que deje de ser mock necesita un backend. Si
        empezamos por MCP, ese backend hay que escribirlo igual, pero después y con prisa.</li>
      <li><b>El MCP solo no alcanza.</b> Un server MCP le sirve a un agente y a nadie más: ni al
        navegador, ni a un cron, ni a un webhook de GitHub — que es justo lo que va a mantener el
        estado al día.</li>
      <li><b>Encima de la API, el MCP es delgado.</b> Seis tools que arman una URL y devuelven el
        JSON. Si la lógica vive en el MCP, hay dos verdades y empiezan a discrepar.</li>
    </ul>

    <!-- ── las tools ────────────────────────────────────────────────────────────────────────── -->
    <h2>Las herramientas</h2>
    <p class="sub2">
      Seis. Cuatro leen, dos escriben. Ninguna toca git: cuadrilla observa los repos, no los
      modifica.
    </p>

    <article v-for="t in TOOLS" :key="t.nombre" class="tool">
      <h3 class="mono">{{ t.nombre }}</h3>
      <p class="para">{{ t.para }}</p>
      <dl>
        <dt>Parámetros</dt>
        <dd class="mono">{{ t.params }}</dd>
        <dt>Devuelve</dt>
        <dd><pre class="mono">{{ t.devuelve }}</pre></dd>
      </dl>
      <p v-if="t.ojo" class="ojo"><b>Ojo:</b> {{ t.ojo }}</p>
    </article>

    <!-- ── el flujo ─────────────────────────────────────────────────────────────────────────── -->
    <h2>Cómo se vería en una sesión</h2>
    <pre class="bloque mono">1  cuadrilla_epicas()
   → el agente ve que «Onboarding con país como dato» va 29% y tiene 3 PRs esperando

2  cuadrilla_epica("pais-como-dato")
   → lee las ramas y, sobre todo, lo que Miguel y José ya documentaron
     (el seeder no es idempotente; el schema es cache-aside)
   → arranca sabiendo eso, en vez de pisar la misma trampa

3  …trabaja, crea la rama y la pushea…

4  cuadrilla_agregar_rama({ epica: "pais-como-dato", repo: "form-service",
                            rama: "feat/country-tree-cascada", quien: "jose",
                            nota: "el data_source del form dinámico" })

5  cuadrilla_documentar({ epica: "pais-como-dato", quien: "jose",
                          texto: "…", trampa: "…" })

   El estado (PR, días, mergeada) nunca se toca: aparece solo.</pre>

    <h2>Cómo se conectaría</h2>
    <pre class="bloque mono">claude mcp add cuadrilla -- node cuadrilla/mcp/server.js</pre>
    <p class="sub2">
      El server leería la API en <span class="mono">http://localhost:5197/api</span> —el mismo origen
      que sirve la Vue, vía proxy de Vite, como ya hacen <span class="mono">trazador</span> y
      <span class="mono">plantillas</span> en el playground.
    </p>

    <!-- ── el antecedente ───────────────────────────────────────────────────────────────────── -->
    <h2>Un antecedente que conviene mirar</h2>
    <p class="antecedente">
      En <span class="mono">playground/context</span> hubo un MCP y <b>se retiró a propósito</b> el
      18 de julio, con la nota de no reconstruirlo: se reemplazó por un mapa estático generado más
      un toolkit de scripts. Vale la pena entender por qué antes de escribir este.
      <br><br>
      La diferencia, y por la que creo que acá sí se sostiene: aquel MCP servía para <b>leer</b>
      conocimiento que ya estaba en archivos —un mapa generado hace lo mismo y no necesita proceso—.
      Este es sobre todo para <b>escribir</b> estado vivo que hoy no existe en ningún archivo, desde
      la sesión en la que se descubre. Si termina usándose solo para leer, la conclusión de
      <span class="mono">context</span> aplica igual y hay que retirarlo.
    </p>
  </div>
</template>

<style scoped>
.doc{max-width:78ch}
.sub{color:var(--page-soft);font-size:13.5px;margin:8px 0 0;line-height:1.65}
.sub2{color:var(--page-soft);font-size:12.5px;margin:8px 0 0;line-height:1.65}

h2{font-size:15px;font-weight:600;margin:34px 0 0;padding-top:18px;border-top:1px solid var(--line)}
h3{font-size:13px;font-weight:500;margin:0}
p{font-size:13.5px;line-height:1.7;color:var(--page-soft);margin:10px 0 0}
p b, li b{color:var(--page-ink);font-weight:500}
i{color:var(--page-tenue)}

.aviso{margin-top:16px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);
  padding:11px 13px;font-size:12.5px}
.aviso b{color:var(--warn)}

.division{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));
  margin-top:14px}
.col{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:13px 15px}
.col h3 i{font-style:normal;font-size:11.5px;font-weight:400;margin-left:6px}
.col ul{margin:10px 0 0;padding-left:17px;font-size:12.5px;color:var(--page-soft);line-height:1.75}
.remate{margin-top:14px}
.remate b{color:var(--page-ink)}

.razones{margin:12px 0 0;padding-left:18px;font-size:13px;color:var(--page-soft);line-height:1.7}
.razones li{margin-bottom:8px}

.tool{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:14px 15px;
  margin-top:10px}
.tool h3{font-size:13px;font-weight:600;color:var(--page-ink)}
.para{font-size:12.5px;margin:6px 0 0}
dl{margin:11px 0 0;display:grid;grid-template-columns:88px 1fr;gap:6px 12px;align-items:baseline}
dt{font-size:11px;color:var(--page-tenue)}
dd{margin:0;font-size:12px;color:var(--page-soft)}
dd pre{margin:0;font-size:11.5px;line-height:1.6;white-space:pre-wrap;color:var(--page-soft)}
.ojo{font-size:12px;margin:11px 0 0;padding-top:10px;border-top:1px solid var(--line)}
.ojo b{color:var(--warn);font-weight:500}

.bloque{margin:12px 0 0;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);
  padding:13px 15px;font-size:11.5px;line-height:1.75;color:var(--page-soft);
  white-space:pre-wrap;overflow-x:auto}

.antecedente{border-left:2px solid var(--line);padding-left:14px;margin-top:14px;font-size:13px}
</style>
