---
id: 84
title: "Tablero"
clase: proyecto
stage: work
created: "2026-09-14T21:40:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del tablero. La agenda, la retoma en frío y el cierre diario ya se
derivan de los archivos, Git, ramas y bitácora. La organización local cambia a siete contenedores
permanentes: una tarea por herramienta y `playground` para asuntos transversales o todavía sin Jira.

La consola inferior de ramas pertenece a la tarea enfocada: muestra una tabla y, a la derecha, sólo
los repos asociados a sus ramas medidas. Conserva **Ramas** en el pie al cerrarse. Cada tarea tiene
una ruta copiable (`#/tareas/context`, `#/tareas/core-543`) que restaura la tarea al recargar y
responde a atrás/adelante.

La cabecera de la tarea concentra sprint, puntos, tiempo en Jira y los enlaces de contexto local. El
sidebar derecho ya no repite una ficha de detalle: usa tres pestañas —Jira, Pendientes y Artifacts, cada
artifact con su tipo—. Jira abre primero, ocupa todo el alto y muestra la descripción sin marco de
tarjeta. En ventanas medianas el sidebar se pliega y se recupera desde el pie o desde el avance de
pendientes de la cabecera.

La pulida visual comparte una sola gramática entre regiones: filas activas de superficie suave,
pestañas compactas con el mismo estado seleccionado, controles agrupados y tablas con seguimiento al
pasar el cursor. La consola evita repetir el conteo de ramas y conserva toda la información operativa.

La recarga ahora pinta el último snapshot correcto del sprint y restaura la ruta inmediatamente. Jira
se revalida por `fetch` en segundo plano, las fuentes locales cargan en paralelo y el pie muestra el
estado de sincronización; una respuesta remota lenta ya no desmonta el editor ni la consola.

Cada tarea de Jira muestra en su fila un icono para avanzar. Al abrirlo consulta las transiciones
reales y ofrece sólo el paso siguiente del flujo normal, sin mezclar bloqueos, invalidaciones ni
retrocesos. La tabla de ramas fija Rama y PR durante el desplazamiento, explica los estados de
ambientes y usa una fecha de medición relativa. Una tarea sin ramas conserva una franja compacta.

**Menos ruido (2026-09-23), a pedido de Miguel, hasta encontrarles un uso adecuado.** Se retiró Jev
entero —el **✦ Orientar** de la cabecera, el **✦** de Pendientes, el laboratorio `make tablero-jev` con
su banco de casos y las dos rutas del server— y queda sólo la conexión con su API
(`tools/jev_transport.py`, pruebas offline en `make tablero-jev-test`). También se fue la fila «Ramas de
la tarea» al final de la evidencia: la consola de ramas ya está abajo, y quien usa la herramienta lo
sabe. Y la sección fija «Harness · comandos reproducibles», con su enlace al panel y `HARNESS_URL`: en
las tareas sin prueba era un hueco que pedía llenarse; una prueba ejecutada sigue apareciendo dentro del
hito que la usó.

**La cronología es un acordeón (2026-09-23).** Cada fecha —Hoy, Ayer y las anteriores— es un
encabezado que se pega arriba mientras se lee su contenido; el día siguiente lo empuja al llegar y un
clic lo pliega, y plegar un día pegado lo deja en el borde en vez de saltar lejos. Al hacerlo salieron
tres defectos del pegado, medidos en vivo: el `top: 0` compartido lo dejaba 20px abajo, bajo el padding
del cuerpo, y el texto se asomaba por encima (más una fila de un píxel por el alto fraccionario de la
cabecera); el chevron quedaba al centro de la banda porque `taller.css` estira al primer hijo; y el
reset de `button.region-head` olvidaba el borde de arriba, 2px `outset` del navegador — arreglado en la
fuente compartida (`tools/ui/taller.css`) y sincronizado a las tres UIs. `make tablero-ui-offline` lo
comprueba, y se probó al revés: sin la compensación o sin el regreso al borde, el chequeo falla.

`make retomar N=<id> BRIEF=1` suma al final la ficha de cada tema de canon que la tarea declara en
`canon:`, hasta cuatro; `BRIEF=a,b` elige. La ficha sale de `GET /api/read` de canon (no de un modelo)
y decide qué `context.md` se abre, no lo reemplaza.

**Frente cerrado (2026-09-23): el código del tablero pasa a inglés — identificadores, archivos, carpetas
y claves JSON.** Pedido de Miguel; extiende a esta herramienta la regla que ya regía en los repos de la
compañía (identificadores en inglés, comentarios en español). El contenido de las tareas —sus títulos de
sección y el frontmatter que se escribe a mano— **no** entra: es texto, no código. `tema.css` y
`taller.css` quedan como nombres propios, por decisión de Miguel. Detalle, fases e inventario en «Frente:
el código en inglés», abajo.

**Estado (2026-09-23):** fase 0 decidida —`tablero` y los targets de `make` se quedan; el JSON de la
API va en una tanda aparte— y **fase 1 hecha**: 1.035 identificadores de Go y ~235 de Vue/JS en inglés,
con las salidas de consola (32 invocaciones) y de la API web (17 GETs) idénticas byte a byte contra el
binario de antes, y la interfaz vieja y la nueva dando la misma huella en 36 pasos de clics. **Fase 1b
hecha** el mismo día: 116 identificadores del Python de `tools/`, con las 11 salidas de sus herramientas
idénticas al código anterior. **Fase 2 hecha** también: 26 archivos renombrados con `git mv`
(`store/annotations.go`, `tools/citations.py`, `TASK-TEMPLATE.md`, `docs/ARCHITECTURE.md`…). **Fase 3 hecha**: `cmd/{today,closeout,branches,tasks,worklog,pulse}`,
`internal/pulse` y `data/traps`, con el LaunchAgent del pulso reinstalado sobre `bin/pulse` y
escribiendo. Quedan como nombres propios `cmd/cuadrilla`, la etiqueta del agente
(`com.creditop.tablero.pulso`) y su log. **Fase 4 hecha**: `make tablero-naming` frena un nombre nuevo
que no es inglés, y al estrenarse encontró 13 nombres en español (25 declaraciones) que las fases 1–3 no habían visto; se renombraron.
**Fase 4b hecha** el mismo día: las claves JSON pasaron a inglés —122 en el server, 157 propiedades en
la UI, 37 en `jev.py` y el hook de cierre— y el contrato subió a `tablero.task.v2`
(`schemas/task.v2.schema.json`). Consola y API dan lo mismo que el binario anterior salvo el nombre de
las claves (45/45), y la interfaz vieja con su server y la nueva con el suyo dan la misma huella (46/46
regiones). `make tablero-naming` ahora también mira las claves JSON. Con eso, y con `tema.css`/`taller.css`
declarados nombres propios, el frente quedó cerrado.

**Cada tarea es una carpeta (2026-09-23).** `tablero/tasks/<slug>/` con `task.md`, `context.jsonl` y
`artifacts/`; `data/` quedó para lo operativo (bitácora, pulso, cachés, settings, trampas). Movidas las
46 tareas, 22 pilas y 21 artifacts con `git mv`; dónde vive cada cosa lo sabe `server/internal/layout`, y
«días sin tocar» y el cierre siguen las mudanzas. Detalle en «Frente: cada tarea es una carpeta».

**La interfaz y lo que quedó muerto (2026-09-23).** El server se quedó con lo que la UI lee: se fueron
el WebSocket del dashboard original, el guard servido a la UI, los ajustes (`settings.json`), la
escritura de tareas y de bitácora —la UI dejó de escribir el 2026-07-21— y la consola de repos que
sólo leía la vista de `context` (`make repos`). Son 1.085 líneas netas de Go, la dependencia del
WebSocket y 34 reglas de CSS. En la interfaz, cinco arreglos: el avance de pendientes abre la región
lateral aunque esté plegada, los hitos llevan el espacio tras su rótulo, los enlaces del documento
toman el color del tema, los pendientes ya no llevan viñeta y casilla, y la pestaña «Prototipos» pasó
a «Artifacts», con el tipo de cada archivo. `make tablero-ui-offline` los comprueba sin servidores.
Detalle en «Frente: la interfaz y lo que quedó muerto».

**El próximo paso es:** que Miguel decida el formato nuevo de la pila de contexto —la propuesta y sus
dos preguntas están en «Frente: la pila de contexto como formato de adición»—; con eso se implementa y se
migran los 34 hitos que hay. Después sigue el contenedor `cuadrilla` (#93), también decisión suya.

> **MEDICIÓN · 2026-09-23** — el cierre del día salía 1 por dos avisos falsos, y ninguno era trabajo sin registrar. (1) #46 y #47 estaban tocadas sólo por los barridos de rutas de la fase 3 y la mudanza a carpetas, y su entrada del día declaraba «sin avance»: la bitácora quedaba eximida, pero se les exigía reescribir una retoma que no había cambiado. Ahora el marcador exime también esa pieza (`resumeState`, con prueba de que sin el marcador la misma retoma se vuelve a reclamar). (2) `microservices/customer-service/main` y `microservices/financial-health-service/main` salían como ramas sin dueño, y el pulso las había visto por un `pull --tags origin main: Fast-forward`: `isBaseBranch` partía «repo/rama» en la primera barra y leía la rama «customer-service/main». Ahora la base se decide antes de unir repo y rama (`dayBranches`, con prueba del repo con barra y de una rama `fix/main` que no es base). Con los dos arreglos, `make cierre` da «todo en orden» y sale 0.
> make cierre; cd tablero/server && go test ./cmd/closeout

> **MEDICIÓN · 2026-09-19** — sobre la tarea KYC #47, el Markdown completo pesa 64.571 bytes; la proyección compacta pesa 6.243 bytes (**90,3 % menos**) y la variante con borrador 11.856 bytes.
> make tarea-json N=47; make tarea-json N=47 CONTENIDO=1; wc -c

> **MEDICIÓN · 2026-09-21** — sobre la tarea KYC #47: la retoma pesa 3.832 bytes; con `BRIEF=1` 18.540 bytes (sus tres fichas) contra 96.313 de sus tres `doc.md` (**80,8 % menos** que abrirlos). La ficha de `kyc` sola: 5.074 bytes contra 55.302 de su doc. Las 24 tareas vivas declaran `context_nodes`: al retomar no hay nodo que elegir, así que Jev `route` ahí no ahorra nada.
> make retomar N=47; make retomar N=47 BRIEF=1; cat context/server/data/flows/{kyc,credifamilia,deceval}/doc.md | wc -c

## Pendientes

- [x] **El cierre reclamaba de más.** La bitácora de un barrido ya la eximía el marcador «sin avance»
      (el 21/9; la pista de deducirlo del diff se había descartado porque el barrido también escribe su
      nota). Lo que quedaba, medido el 2026-09-23: a #46 y #47, tocadas sólo por barridos y declaradas
      «sin avance», les exigía reescribir la retoma —ahora el marcador exime también esa pieza—, y dos
      `pull` a `main` de microservicios salían como ramas sin dueño —la rama base se decide ahora con la
      rama sola—. `make cierre` sale 0.

- [x] Nombres en inglés · fase 0 — decidido por Miguel el 2026-09-23: `tablero` y los targets de
      `make` se quedan; el JSON va después (DECISIÓN en el frente).
- [x] Nombres en inglés · fase 1: identificadores de Go y Vue/JS — `ab-cli.sh` 32/32 y `ab-web.sh`
      17/17 idénticos contra el árbol anterior; interfaz vieja vs nueva, misma huella en 36 pasos.
- [x] Nombres en inglés · fase 1b: identificadores del Python de `tools/` — 116 en `citas.py`,
      `ramas.py`, `trampas.py` y `test_ramas.py` (`jev.py` ya estaba en inglés); `ab-py.sh` 11/11,
      los mismos nombres libres por archivo y los tests en verde.
- [x] Nombres en inglés · fase 2: 26 archivos — `ab-cli.sh` 32/32, `ab-web.sh` 17/17, `ab-py.sh`
      14/14 (incluido `make trampas`, `make repos-test` y el import de `huella.py` del trazador) y el
      `anotacion.spec.ts` del arnés en verde. `schemas/tarea.v1.schema.json` pasa a la 4b.
- [x] Nombres en inglés · fase 3: 8 carpetas — `ab-cli.sh` 32/32, `ab-web.sh` 17/17, `ab-make.sh`
      21/21 (targets de `make` y los dos hooks) y el pulso escribiendo con el binario nuevo.
- [x] Nombres en inglés · fase 4: `make tablero-naming` — sale 1 con nombres españoles inventados
      en Go, Vue/JS, Python y un nombre de archivo, y 0 sin ellos; `make tablero-naming-test` 11/11.
- [x] Nombres en inglés · fase 4b: las claves JSON, con el contrato en `tablero.task.v2` — consola y API
      45/45 (`ab-json.sh`), interfaz 46/46 regiones (`ab-ui.sh`), hooks y `jev.py` leyendo las claves
      nuevas, y `make tablero-naming` mirándolas.
- [x] Decidir `tema.css` y `taller.css` — quedan como nombres propios (DECISIÓN de Miguel en el frente);
      con eso el frente del inglés queda cerrado.
- [x] Cada tarea es una carpeta: `tasks/<slug>/{task.md,context.jsonl,artifacts/}` — 89 movimientos, consola 31/33, API 15/17 + 2 con los cambios buscados, hooks probados con casos que fallan.
- [x] Mirar la interfaz andando con la forma nueva — la pestaña de #46 muestra «Artifacts 7» y abrir el
      primero muestra el archivo; el `dist/` real contra el server nuevo, en un Chromium sin cabeza.
- [x] Sacar los 5 colores literales del resaltado SQL de `src/App.vue` a tokens — `--sql-*` en la capa
      semántica de `styles.css`; `make estilo-check` sale 0.
- [ ] Resolver el contenedor `cuadrilla` (#93): el lint lo marca fuera de los siete nombres
      canónicos; termina cuando `make tareas TODAS=1` no muestra el ⚠ — sumándolo a la lista o
      absorbiéndolo en `playground`.
- [x] Actualizar `docs/ARCHITECTURE.md`: el «Recorrido diario» describe la cronología del centro, las
      tres pestañas y la consola de ramas.
- [x] Reiniciar y probar la interfaz con el código nuevo — a pedido de Miguel, en vivo: la API llega con
      las claves en inglés, los cinco arreglos andan a 800 y a 1440px, un artifact abre, y la auditoría de
      contraste de lo que se pinta encontró 51 nodos bajo AA que se corrigieron (ver el frente).
- [ ] Comprobar que ninguna tarea local nueva nazca fuera de los siete nombres canónicos.
- [ ] Confirmar que bitácora y retoma siguen agrupadas bajo la herramienta correcta.
- [ ] Medir cuántos archivos y tokens evita `make tarea-json` en una retoma real con workers.
- [x] Reunir una muestra representativa de etiquetas antes de comparar Jev con trabajo real — ya no
      aplica: Jev se retiró del tablero el 2026-09-23 y queda sólo la conexión.
- [ ] Medir, en una semana de retomas reales, cuántas veces la ficha de `BRIEF=1` alcanzó y cuántas se abrió el doc igual — si es siempre, la ficha no está decidiendo nada.

## Frente: el código en inglés (cerrado el 2026-09-23)

**Objetivo.** Todo lo que alguien escribe al INVOCAR el tablero —identificadores, nombres de archivo y
de carpeta— en inglés. Lo que se lee para ENTENDER —comentarios, docblocks, `CLAUDE.md`, las tareas de
`data/`— queda en español. Es la misma prueba que ya rige en los repos de la compañía.

**Inventario medido el 2026-09-23** (fuera de `data/`, `node_modules/` y `dist/`):

| capa | en español | quién más lo lee |
|---|---|---|
| funciones y tipos Go | 129 de 469 (`Anotaciones`, `FuentesDe`, `ProximoPaso`, `MedirRamas`, `Retoma`…) | el arnés lee el regex `reAnotacion` de `store/anotaciones.go` por RUTA y NOMBRE |
| identificadores JS/Vue | 78 de 536 declarados | nadie de afuera |
| etiquetas JSON de la API | 31 (`proximoPaso`, `pendientesAbiertos`, `diasSinTocar`, `ramasPatron`…) | el front, los hooks y el contrato `tablero.tarea.v1` |
| archivos | 22 (`store/{anotaciones,fuentes,retoma,pendientes,ramas,toques}.go` y sus tests, `tools/{ramas,citas,trampas}.py`, `PLANTILLA-TAREA*.md`, `ARQUITECTURA.md`) | `Makefile` raíz, hooks, `CLAUDE.md` raíz, 4 tareas |
| carpetas | 8 (`server/cmd/{hoy,cierre,ramas,tareas,bitacora,pulso,cuadrilla}`, `internal/pulso`) + `data/trampas` | `Makefile` (26 líneas), `.claude/hooks/{cierre,tarea-lint}.py`, el LaunchAgent del pulso (ruta del binario) |

**Fases, en orden de riesgo** — cada una es un commit y termina en verde antes de la siguiente:

0. **Decidir los nombres propios.** ✔ Hecho.

   > **DECISIÓN · 2026-09-23 · Miguel** — la carpeta `tablero` y los targets de `make` (`tareas`, `retomar`, `cierre`, `hoy`, `bitacora`, `pulso`) se quedan como nombres propios; lo de adentro se traduce. El JSON de la API va después, en su propia tanda (4b), porque cambia un contrato versionado. Por lo mismo quedan `tableroRoot` y `trazadorCount`: nombran herramientas.

1. **Identificadores** (Go y Vue/JS). ✔ Hecho el 2026-09-23. El contrato de afuera no se movió: las
   etiquetas JSON, los campos sin etiqueta que se serializan por nombre (se comprobó uno por uno) y
   las claves de objeto del front siguen en español, porque son la fase 4b.

   > **MEDICIÓN · 2026-09-23** — el inventario de arriba contaba sólo funciones y tipos. Contando todo lo que se declara (campos, parámetros, locales, parámetros de tipos función) fueron **1.035 identificadores de Go** en 51 archivos (3.900 ediciones) y **~235 de Vue/JS** (≈1.000 ediciones, casi todas en `App.vue`). Salidas contra el binario anterior: 32/32 invocaciones de consola y 17/17 GETs de la API idénticos; la única diferencia es el id nuevo que genera `task-context -n` en cada corrida.
   > tablero/tools/rename/ab-cli.sh <árbol-anterior> && tablero/tools/rename/ab-web.sh

   > **DECISIÓN · 2026-09-23** — no `gopls rename` uno por uno, sino un renombrador propio sobre el type checker (`tools/rename/go/cmd/ren`), que aplica un mapa entero y **rechaza** el rename si el nombre nuevo choca: visible en el scope, declarado en uno interno, ya presente en el struct o el receptor, o si dos nombres viejos distintos van al mismo nuevo en scopes anidados — ese es el caso que compila y sombrea en silencio. Frenó 18 renames (7 de Go, 11 de Vue/JS): `amb → env` habría tapado el paquete `env`, `dias → days` una bandera `days`, `evento → event` una variable interna.
   > cd tablero/server && <bin-de-ren> -map ../tools/rename/maps/phase1-go.tsv ./...

   > **RIESGO · 2026-09-23** — el diccionario del sistema no sirve para detectar español: trae inglés arcaico (`aviso`, `leer`, `tema`, `antes` pasan como inglés). Lo que sí separó fue contrastar cada palabra contra el código de la stdlib de Go: una palabra que casi no aparece ahí es sospechosa. Las dos pasadas juntas encontraron ~200 nombres que la primera no veía. La fase 4 tiene que usar esa vara, no el diccionario.

   > **MEDICIÓN · 2026-09-23** — en el front, `vite build` y los tests en verde NO prueban un rename: un nombre del template que el script ya no declara compila igual y vale `undefined` en ejecución. Se comprobó que ningún SFC deja nombres sin resolver (`_ctx.x`, antes y después: cero), que el conjunto de identificadores libres de cada archivo es el mismo, y se corrió la interfaz vieja y la nueva lado a lado con la misma secuencia de 36 pasos (filtros, búsqueda, vistas, pestañas, ramas, menú de avance, rutas, atrás): huellas de texto y de clases idénticas en los 36.
   > node tablero/tools/rename/js/unresolved.mjs tablero/src/*.vue; node tablero/tools/rename/js/globals.mjs tablero/src/*.vue tablero/src/*.js

1b. **El Python de `tools/`.** ✔ Hecho el 2026-09-23.

   > **MEDICIÓN · 2026-09-23** — 116 identificadores en cuatro archivos (497 ediciones): 58 en `citas.py`, 31 en `ramas.py`, 20 en `trampas.py`, 7 en `test_ramas.py`; `jev.py` y `jev_transport.py` ya estaban en inglés. Las 11 salidas de `trampas`, `citas`, `jev` y `ramas` (incluido el snapshot que escribe) son idénticas corriendo el código de antes y el de ahora sobre los mismos datos. Se conservan en español los dos nombres que `citas.py` importa de `tools/repos.py` (`del_ref`, `ref_a_indexar`): son de otra herramienta.
   > tablero/tools/rename/ab-py.sh <worktree-anterior>; python3 tablero/tools/rename/py/free.py tablero/tools/*.py

   > **RIESGO · 2026-09-23** — los tests atraparon un error del renombrador que la comparación de salidas no veía: en `test_ramas.py`, `ramas` es el MÓDULO importado, y como `ramas` también es una variable de `ramas.py`, se renombró la referencia al módulo. Las salidas daban igual porque ninguna herramienta corre los tests. Arreglado: un nombre ligado por `import` en un archivo no se toca en ese archivo. Y la vara que lo habría cazado sin tests —los nombres libres por archivo, antes y después— ahora se corre siempre.

2. **Archivos.** `git mv` para no perder la historia. ⚠ El arnés busca `anotaciones.go` y
   `reAnotacion` por nombre: se reapunta `harness/pkg/anotacion.spec.ts` en el MISMO commit, o su
   prueba falla — y si falla por «no encontré», se lee como un rename, no como un error.
   ✔ Hecho el 2026-09-23: 26 archivos. Los mapas de la fase 1 pasaron a `maps/phase1-*.tsv`.

   > **MEDICIÓN · 2026-09-23** — las referencias a los 26 nombres viejos estaban en 24 archivos, y no todas eran nuestras: `trazador/server/fuentes.go` es del trazador y `workers/archivos.json` es un índice derivado de los repos de la compañía. Se reapuntaron 16 archivos (Makefile, `tarea-lint.py`, el arnés, tres `CLAUDE.md`, el README, comentarios de Go y Vue y los imports de Python). Quedan sin tocar, a propósito, la crónica de otras tareas de `data/`, el JSONL de hitos (es append-only) y los mapas (registran posiciones de antes).
   > git grep -nE 'PLANTILLA-TAREA|store/(anotaciones|fuentes|ramas|retoma|pendientes|toques)\.go|tools/(citas|ramas|trampas)\.py' -- . ':!tablero/data'

   > **RIESGO · 2026-09-23** — el trazador importa del tablero: `trazador/tools/huella.py` agrega `tablero/tools` al `sys.path` y hace `from citas import del_ref`. No aparecía buscando la ruta `tablero/tools/citas.py`, porque arma la ruta con `os.path.join(…, "tablero", "tools")`. Renombrar `citas.py` sin tocarlo lo rompía; va en el mismo commit y `ab-py.sh` ahora comprueba ese import.
   > tablero/tools/rename/ab-py.sh <worktree-anterior>

3. **Carpetas.** `server/cmd/*` cambia el nombre del binario: `Makefile`, los dos hooks y el plist
   del LaunchAgent (`bin/pulso`) van juntos. ⚠ Un pulso que deja de escribir no avisa: se lee como un
   día sin trabajo.
   ✔ Hecho el 2026-09-23: `cmd/hoy→today`, `cierre→closeout`, `ramas→branches`, `tareas→tasks`,
   `bitacora→worklog`, `pulso→pulse`, `internal/pulso→internal/pulse` (el paquete también) y
   `data/trampas→data/traps`. Los targets de `make` no cambiaron.

   > **MEDICIÓN · 2026-09-23** — los 21 targets de `make` que leen tareas y los dos hooks dan lo mismo con el `make` nuevo que con el binario anterior; los de `trampas`, `repos-test`, `tablero-jev-test` y `pulso` dan lo mismo en un worktree del commit anterior, salvo la ruta del documento de trampas, que es lo que se mudó.
   > tablero/tools/rename/ab-cli.sh <árbol-anterior> && tablero/tools/rename/ab-make.sh <worktree-anterior>

   > **MEDICIÓN · 2026-09-23** — el pulso siguió escribiendo: el agente se reinstaló con `server/bin/pulse install` (sin `seed`, para no volver a sembrar el pasado), `launchctl` muestra `program = …/bin/pulse` y `last exit code = 0`, y el archivo del mes pasó de 4.559 a 4.560 líneas con un tick de las 10:29:53. El binario viejo `bin/pulso`, que ya no usa nada, se borró.
   > launchctl print gui/$(id -u)/com.creditop.tablero.pulso | grep -E 'program|last exit'; make pulso-status

   > **RIESGO · 2026-09-23** — correr el `make` viejo dentro de un worktree NO sirve para los targets que leen git: con las tareas enlazadas al repo real, git las ve cambiadas y todas salen «0 días sin tocar». Por eso esos targets se comparan contra el binario viejo corrido en el repo real. Y la ruta a las trampas vivía en tres tareas más (#46, #47, `context`): se reapuntó el puntero vigente de cada una y se declaró `sin avance` en su Registro, como el 2026-09-21. #46 ya fallaba el lint antes de esto (declara un tema de canon `repos` que no existe) y quedó igual.

4. **Cablearlo.** Un chequeo en `make` que falle con un identificador nuevo en español (lista de
   raíces del dominio: tarea, rama, pendiente, anotación, fuente, retoma, cierre…), porque una regla
   escrita envejece y un chequeo no.
   4b. Si la fase 0 lo decide: etiquetas JSON, con el contrato subido a `tablero.tarea.v2`.

   ✔ **4b hecha el 2026-09-23**, a pedido de Miguel («Dale continua»). El contrato se llama
   `tablero.task.v2` y no `tablero.tarea.v2` como decía este plan: su nombre es un identificador, y la
   regla es la misma que para el resto.

   > **MEDICIÓN · 2026-09-23** — el inventario por AST (`tools/rename/go/cmd/json-keys`: etiquetas, claves de mapas literales e índices) dio 135 claves en español en el server. Se renombraron 122 en 10 archivos (mapa en `tools/rename/maps/phase4b-json.tsv`, aplicado por contexto con `json/apply-go.py`); las otras son el contrato de otro. Del lado de los consumidores: 157 propiedades en la UI (`js/props.mjs`, que distingue un acceso `x.que` de una clave `{ que }` y deja las claves de un `:class`, que son clases CSS), 37 claves en `jev.py`, su test y el hook de cierre, y los fixtures del tablero en `tools/ui-check.mjs`. Nadie más lee esas salidas: ni workers, ni el arnés, ni el trazador.
   > tablero/tools/rename/json/apply-go.py; node tablero/tools/rename/js/props.mjs -map tablero/tools/rename/maps/phase4b-json.tsv -map tablero/tools/rename/maps/phase4b-ui.tsv tablero/src/*.vue tablero/src/*.js

   > **MEDICIÓN · 2026-09-23** — el binario de antes contra el de ahora, sobre los mismos datos: las 33 invocaciones de consola y los 12 GET de la API dan lo mismo una vez traducidas las claves viejas con el mapa (`json/normalize.py --old`); la única diferencia de valor es la versión del contrato. Se comprobó que la comparación no es vacía: la salida vieja traía `pendientesAbiertos`, `retoma`, `diasSinTocar`, y la nueva, los mismos datos con `openPending`, `resume`, `daysUntouched`. La interfaz vieja con su server y la nueva con el suyo, en 9 tareas × 3 pestañas: 46 regiones idénticas en texto y clases, sin errores de consola.
   > tablero/tools/rename/ab-json.sh <árbol-anterior>; tablero/tools/rename/ab-ui.sh <árbol-anterior-con-src>

   > **DECISIÓN · 2026-09-23** — quedan en español, con su alcance en `tools/naming-allow.txt` (`json:`), las claves que son el contrato de otro: la respuesta de canon (`objetivo`, `secciones`…), la API de cuadrilla (`rama`, `autor`…), los campos de Jira y el frontmatter, que se escribe a mano. Tampoco se tocan los VALORES —`clase: tarea`, los tipos de anotación (`medicion`…), las acciones de Jev, los ids de pestaña—, las clases CSS de un `:class` ni `separador`, que es de `workbench.js`, compartido con harness y trazador.

   > **RIESGO · 2026-09-23** — tres cosas que fallaban en silencio. (1) `/api/ramas` decodifica el caché de ramas en structs: con las etiquetas nuevas, el archivo viejo se habría leído VACÍO, «sin medición», sin un error; se convirtió una vez (`migrations/2026-09-23-json-keys/convert-cache.py`) y `make tareas-ramas` ya lo escribe con las claves nuevas. (2) El caché de arranque del navegador guardaba la foto con `porSprint`: pasa a `VERSION = 2` y la foto vieja se descarta en vez de pintarse con campos vacíos. (3) Al rearmar el caché viejo para comparar, el camino inverso convirtió el `draft` de los PRs —que siempre fue inglés— en `borrador`, porque `borrador → draft` está en el mapa; el comparador marcó una diferencia que era suya. Se arregló (`REVERSE_KEEP`), y el caché rearmado quedó idéntico al real.

   > **MEDICIÓN · 2026-09-23** — `make tablero-naming` mira ahora 896 claves JSON además de los identificadores. Con una sonda de tres etiquetas —`proximoPaso`, y `rama` y `nombre` fuera de cuadrilla, donde sí están aceptadas— salió 1 y nombró las tres; sin ella, 0. `make tablero-naming-test` 12/12, con una prueba de que una clave aceptada en un lugar no queda aceptada en otro ni se vuelve una palabra permitida.
   > make tablero-naming; make tablero-naming-test

   ✔ Hecho el 2026-09-23: `tools/naming.py`, cableado en `make tablero-naming` y probado por
   `make tablero-naming-test`.

   > **MEDICIÓN · 2026-09-23** — el chequeo lee 4.836 nombres de Go, 1.390 de Vue/JS, 863 de Python y 182 rutas. Con cuatro sondas inventadas (`leerTareaVieja` en Go, `guardarNota` en JS, `cargar_fecha` en Python y `zz-notas-viejas.md`) salió 1 y nombró las siete, incluidas `antes` y `texto`, que el diccionario del sistema acepta; sin ellas, 0.
   > make tablero-naming; make tablero-naming-test

   > **MEDICIÓN · 2026-09-23** — al estrenarse encontró 13 nombres en español, en 25 declaraciones, que las fases 1–3 no habían visto: en Go `en` (siete, «está en» un ambiente), `ya`, `es` y `del`; en Vue/JS `vistos`, `nodo`, `ancla`, `fijar`, `restaurarFoco`, `horas`, `clave`, `CEL`, `JHL`. Se renombraron (mapas en `tools/rename/maps/phase4-*.tsv`) con la consola 32/32 y la API 17/17 iguales al binario anterior, y en la interfaz los enlaces a canon, el menú de avance con su foco, la pestaña fijada y la grilla de la jornada se comprobaron andando.
   > tablero/tools/rename/ab-cli.sh <árbol-anterior> && tablero/tools/rename/ab-web.sh

   > **RIESGO · 2026-09-23** — por qué la fase 1 se los saltó: el detector de JS sólo contaba como declarado lo que crea un `const x` o un parámetro simple, no una desestructuración (`const [nodo, ancla] = …`) ni un parámetro con valor por defecto (`fijar = false`). El renombrador heredaba el mismo punto ciego. Hoy los dos usan `tools/rename/js/decls.mjs`. La lección es la del `CLAUDE.md` raíz, «una es la vara de otra»: el chequeo tiene que ser independiente de lo que se usó para renombrar, o repite sus huecos.

   > **DECISIÓN · 2026-09-23** — `schemas/tarea.v1.schema.json` y `src/tema.css` se aceptan en español con su motivo en `tools/naming-allow.txt`: el primero cambia con el contrato (4b); el segundo es compartido con harness y trazador. `src/taller.css` es el mismo caso y el chequeo no lo ve, porque `taller` también es inglés: es el límite conocido de la vara. *(La excepción del schema se retiró con la 4b: hoy es `schemas/task.v2.schema.json`.)*

   > **DECISIÓN · 2026-09-23 · Miguel** — `tema.css` y `taller.css` quedan como nombres propios, igual que `tablero` y los targets de `make`. Son los dos archivos del sistema de diseño que comparten las tres UIs (fuente en `tools/ui/`); renombrarlos habría tocado harness, trazador, los `estilo-*` del `Makefile` y buena parte del `CLAUDE.md` raíz sin ganar nada que el chequeo de nombres no cubra ya. Con esto el frente queda cerrado.

**Lo que NO entra.** El contenido de `data/` (tareas, títulos de sección como «Si retomás esto sin
contexto», frontmatter `ramas:`/`canon:`), los mensajes que imprime la consola y los comentarios. El
parser lee esos títulos de sección: traducirlos obligaría a migrar las 46 tareas, y las publicadas no
se migran (decisión del 2026-08-20).

**Cómo se comprueba cada fase.** Un rename correcto no cambia ni un byte de lo que se ve, así que la
vara es el binario de ANTES contra el de AHORA, corridos uno tras otro sobre los mismos datos:

    git archive HEAD tablero/server | tar -x -C /tmp/tablero-antes     # antes de tocar nada
    tablero/tools/rename/ab-cli.sh /tmp/tablero-antes                   # 32 invocaciones de consola
    tablero/tools/rename/ab-web.sh                                      # 17 GETs de la API
    cd tablero/server && gofmt -l . && go vet ./... && go test -count=1 ./...
    cd tablero && npm test && npx vite build
    node tablero/tools/rename/js/unresolved.mjs tablero/src/*.vue       # «—» en todos
    node tablero/tools/rename/js/globals.mjs tablero/src/*.vue tablero/src/*.js   # igual a antes
    cd tablero/tools && python3 -m unittest test_jev test_branches
    tablero/tools/rename/ab-py.sh <worktree-anterior>                   # 14 corridas de las herramientas Python
    make estilo-check · make trampas · cd harness && npx playwright test pkg/anotacion.spec.ts
    make tablero-naming                                                 # ningún nombre nuevo en español

⚠ **No sirve guardar las salidas antes y compararlas después**: se probó y dio un falso rojo en
`cierre -json`. El pulso escribe cada 5′, así que entre una foto y la otra `pulsoMinutos` pasó de 0 a
5 sin que el código cambiara. Correr los dos binarios seguidos elimina esa deriva.

El recorrido de la interfaz se hizo levantando el front viejo (`git archive` de `tablero/src` en
`tablero/.runs/`, que está ignorado) en otro puerto contra la misma API, y corriendo la misma
secuencia de clics en las dos pestañas. Los mapas de la fase 1, viejo → nuevo, quedaron en
`tools/rename/maps/`: sirven para encontrar un nombre viejo citado en una tarea o un `CLAUDE.md`.

## Frente: cada tarea es una carpeta

**Objetivo.** Que todo lo de una tarea viva junto: `tasks/<slug>/task.md`, `context.jsonl` y
`artifacts/`. Pedido de Miguel el 2026-09-23, con `task.md` como nombre fijo del documento.

> **MEDICIÓN · 2026-09-23** — la unión por nombre ya había fallado: de 21 artifacts, 13 no eran `.html` y la pestaña no los mostraba nunca, y el prototipo de la tarea 48 quedó huérfano cuando la tarea se renombró el 2026-08-14 (de `cuadrilla-donde-viven-las-herramientas` a `playground-donde-viven-las-herramientas`). Con carpetas, la pestaña pasó a mostrar los 21.
> python3 tablero/tools/rename/migrations/2026-09-23-tasks/move.py   (el plan; ya se aplicó)

> **DECISIÓN · 2026-09-23 · Miguel** — el documento se llama `task.md` en todas las carpetas (el slug vive en el nombre de la carpeta), y `motai-v2-que-se-hizo.md` es de `motai-v2`. Los otros artifacts sueltos se asignaron por evidencia: `bcp-que-revisar-2026-09-07.md` a `bcp-peru-estructurar-entidad` (entró en b4be9093 junto con ella), el de la tarea 48 a su tarea (con el nombre nuevo) y `agente-soporte-endpoints-n8n.md` a `agente-soporte-modificacion-datos`, que lo cita.

> **RIESGO · 2026-09-23** — mover confunde a git: «días sin tocar» y el cierre salían de `git log` por RUTA, así que mover 46 tareas las habría marcado a todas tocadas hoy. `layout.LastTouches`, `TouchedOn` y `DocumentBefore` siguen las mudanzas: un movimiento puro (R100) no cuenta, mover y editar sí, un renombre de slug hereda la historia. Seis pruebas contra un repo de juguete. Dos cosas que se aprendieron probándolo: `git log -1 --before=… --follow` no cruza una mudanza posterior (se pide la historia entera y se filtra), y `status --porcelain=v2` imprime rutas relativas al directorio actual mientras `git log` las da desde la raíz.
> cd tablero/server && go test ./internal/layout

> **MEDICIÓN · 2026-09-23** — comparado contra el binario del commit anterior corriendo en un worktree con la forma vieja y los mismos datos: consola 31/33 (las dos diferencias son el lint, que ahora nombra la tarea por su slug, y el id aleatorio de `task-context -n`), API 15/17 idénticos y los otros dos —`/api/efforts` y `/api/jira-inbox`— iguales salvo `artifacts`, `file` y `slug`, que cambian por diseño. Los dos cierres (hoy y el 21/9) salen idénticos. La primera corrida no: con la mudanza sin commitear, `DocumentBefore` no tenía historia en la ruta nueva y el cierre salteaba a #84 y #89; se arregló siguiendo el renombre del índice.
> tablero/tools/rename/migrations/2026-09-23-tasks/ab-move.sh <worktree> && …/ab-web-move.sh <worktree>

> **RIESGO · 2026-09-23** — el hook de lint de tareas estuvo APAGADO en silencio desde la fase 3: comprobaba que existiera `cmd/tareas`, que pasó a `cmd/tasks`, y la búsqueda de referencias no lo vio porque la ruta estaba armada con el `/` de pathlib. Ahora apunta a `tasks/<slug>/task.md`, frena un `.md` suelto en `data/` y se probó con una tarea inválida (sale 2), una suelta en `data/` (sale 2) y una válida (sale 0). La lección: probar un hook con un caso que tiene que FALLAR, no con uno que pasa.

**Lo que no se hizo.** No se pudo mirar la interfaz andando: el lanzador de previews de esta sesión no dejó arriba los servidores de prueba. La API que la alimenta y la ruta de los artifacts sí se comprobaron (incluido que no deja salir de la carpeta con `..`). Quedan con la ruta vieja, a propósito, las anotaciones fechadas de otras tareas y las memorias que ya apuntaban a tareas que no existen.

## Frente: la interfaz y lo que quedó muerto

**Objetivo.** Pedido de Miguel el 2026-09-23: mejorar la interfaz y sacar lo que quedó muerto y no se va
a usar. «Muerto» se midió, no se opinó: una ruta del server sin nadie que la llame (la UI, las
herramientas, los hooks), una función que `deadcode` no alcanza desde ningún `main`, un campo que se
asigna y nadie lee, una regla de CSS cuyo selector no puede coincidir con nada.

> **MEDICIÓN · 2026-09-23** — rutas retiradas del server: `/ws` (el WebSocket del dashboard original; la UI de Vue nunca lo usó), `/api/guard` (sin consumidor desde siempre), `/api/settings` (el engranaje se fue el 2026-08-18), `/api/repos-ramas` y `/api/canon/references` (las leía la vista de `context`, apagada el 2026-09-21), `GET/PUT /api/task`, el `PUT/POST` de `/api/efforts` y el `POST`/`DELETE` de la bitácora (la UI dejó de escribir el 2026-07-21: «el asistente escribe, el tablero muestra»). Con ellas se fueron 33 funciones —17 del store, 10 del server, 4 del cliente de Jira (tres eran `activity.go` entero) y 2 envoltorios—, cuatro campos del server —el cliente Slack del bot sólo existía para anunciarse en el log— y la «capa local» de estado real, definición y estimados, cuyo archivo ya no existía: en las 41 claves de `/api/task-locals`, ninguno de esos campos tenía valor. `deadcode` y `staticcheck -checks U1000` quedan en cero.
> cd tablero/server && GOFLAGS=-mod=mod go run golang.org/x/tools/cmd/deadcode@v0.50.0 ./...

> **MEDICIÓN · 2026-09-23** — el binario de `HEAD` contra el nuevo, sobre los mismos datos: los 12 GET que lee la UI salen idénticos byte a byte salvo `/api/task-locals`, que es exactamente la proyección `{taskKey, effortId}` del viejo; las 10 rutas o verbos retirados dan 404 o 405 en el nuevo. Con los datos reales en un Chromium sin cabeza, la UI no tira errores de consola y sólo pide rutas vivas.

> **RIESGO · 2026-09-23** — para comparar las rutas retiradas mandé un `DELETE /api/entries/1` al binario VIEJO, que corre sobre los datos reales y todavía borra. No escribió nada porque la entrada 1 no existe (el archivo del mes no cambió), pero pudo haber marcado como borrada una entrada verdadera. En un A/B, a una ruta que escribe se le pregunta sólo al binario nuevo, o se le pasa un id que no existe a propósito.

> **MEDICIÓN · 2026-09-23** — `make tablero-ui-offline` corre la UI compilada sin servidores (el `dist/` desde disco, la API simulada) y comprueba los cinco arreglos de la interfaz. Contra la UI de `HEAD` fallan los seis chequeos específicos, cada uno por su causa; contra la nueva pasan los ocho.
> make tablero-ui-offline

> **DECISIÓN · 2026-09-23** — los métodos que quedaron de sólo lectura (`/api/efforts`, `/api/entries`) responden 405 a cualquier otro verbo en vez de devolver la lista: un cliente viejo que escribe tiene que enterarse de que no se guardó.

> **MEDICIÓN · 2026-09-23** — reiniciado y probado en vivo (a pedido de Miguel): el server arrancó con el log nuevo y sin el cliente del bot, y la API ya llega con las claves en inglés. A 800px, el avance de pendientes abre la región plegada; a 1440px, también después de ocultarla desde el pie. Los rótulos llevan su espacio y el enlace «#1175» toma el color primario, subrayado. La consola de ramas muestra los PR con su estado, y un artifact abre desde `/artifacts/`. Nada de esto rompió la 4b; lo que sí apareció fue el contraste: `make estilo-contraste` —que antes no se podía correr porque no había server— encontró **51 nodos de texto bajo AA** en la tarea que abre, en 7 casos, todos previos: `opacity` apilada en el pie y los chips de los hallazgos, la clave de la fila elegida (4,05), el «N ramas» del repo elegido (3,86), el chip «sin cómo» (4,38) y la palabra clave del SQL sobre un hallazgo vencido (4,48, 39 nodos). Midiendo además la opacidad de los ANCESTROS, que la auditoría no miraba, aparecieron 10 más: la fecha y la antigüedad de cada hallazgo no vencido, en 3,53. Se corrigieron con la rampa (`--tenue`, `--txt`, `--accent-foreground`) en vez de opacidad, y `--sql-keyword` pasó a `#bd94ff` (5,52). Con eso, la auditoría queda en verde y no hay ningún nodo bajo AA en cuatro tareas contando la opacidad heredada. `tools/contraste.js` ahora multiplica la opacidad de la cadena entera; con eso, el panel del harness pasó de 7 a 21 nodos bajo AA, y quedó como tarea aparte.
> make estilo-contraste SOLO=tablero

**Lo que no se hizo.** `tema.css` y `taller.css` siguen sin decidir, y `jira-preview.js` conserva sus
colores literales a propósito: es un documento aislado dentro de un iframe, donde los tokens del tema no
llegan.

## Frente: la pila de contexto como formato de adición (propuesta, espera a Miguel)

**Objetivo.** Pedido de Miguel el 2026-09-23: que agregar contexto a una tarea sea más estricto, y que
cada apilamiento pueda llevar VARIAS cosas en vez de ser un tipo de hito con su estructura fija.

> **MEDICIÓN · 2026-09-23** — hoy hay 22 pilas con 34 hitos: 30 son `checkpoint`, 2 `blocker`, 2 `decision` y ninguno `evidence`; sólo uno trae referencias, y en un solo día de 23 una tarea recibió más de un hito. O sea que el tipo por hito casi no se usa: cada sesión escribe un checkpoint y mete lo que pasó en la prosa de `summary` y `state`. Mientras tanto, los cuerpos de las tareas tienen 178 anotaciones fechadas (MEDICIÓN, DECISIÓN, PREGUNTA, RIESGO, CANON): los hechos con estructura viven en el Markdown, no en la pila.
> cat tablero/tasks/*/context.jsonl | jq -r .kind | sort | uniq -c; grep -c '> \*\*\(MEDICIÓN\|DECISIÓN\|PREGUNTA\|RIESGO\|CANON\)' tablero/tasks/*/task.md

**La propuesta.** Un apilamiento = una pasada de trabajo: un sobre con una línea de resumen y una lista de
ÍTEMS. Lo estricto va en cada ítem, no en el sobre: los tipos son un conjunto cerrado y cada uno exige lo
suyo —una medición, el comando que la reproduce; una decisión, su motivo; una pregunta o un bloqueo, a
quién se espera—. A lo sumo un ítem `estado` por apilamiento (con el próximo paso), y el último de la pila
es el estado vigente. La herramienta pone `id` y `at`, valida y rechaza; nunca se escribe a mano.

```json
{"schema": "tablero.task-context/v2", "id": "ctx_…", "at": "2026-09-23T14:05:00-05:00",
 "summary": "qué cambió en esta pasada, en una línea",
 "items": [
   {"type": "state", "text": "el estado vigente", "next": "UNA acción"},
   {"type": "decision", "text": "qué se decidió", "reason": "por qué", "by": "Miguel"},
   {"type": "measurement", "text": "qué se midió y qué dio", "how": "el comando", "env": "prod"},
   {"type": "question", "text": "qué falta saber", "waitingOn": "a quién"},
   {"type": "risk", "text": "qué puede salir mal"},
   {"type": "reference", "kind": "canon | pr | db | harness", "target": "…"}
 ]}
```

Los 34 hitos de hoy se migran solos: un `checkpoint` es un sobre con un ítem `state`, un `decision` es un
ítem `decision`, un `blocker` es un ítem `question` con su `waitingOn`.

**Las dos preguntas para Miguel.** (1) ¿Las 178 anotaciones fechadas del cuerpo se mudan a la pila como
ítems? Es lo que convierte la pila en EL lugar de los hechos con fecha —la idea original: leer en el tiempo
dónde empezamos y dónde estamos— y deja el Markdown con el estado vigente, los pendientes y la publicable;
sin eso, la pila es un tercer lugar además del cuerpo y el Registro. (2) ¿Qué tipos de ítem? Los seis de
arriba cubren lo que hoy aparece; `blocker` se absorbe en `question`.

## Cómo se comprueba

`make tareas TODAS=1`, `make tarea-json N=tablero`, `make tablero-jev-test`, los tests del servidor
(`go test ./cmd/today/` cubre el tope y los errores de `BRIEF=`), `make retomar N=47 BRIEF=1`,
`make cierre JSON=1`, `make tablero-ui-offline` (la interfaz sin servidores) y `make estilo-check`.

## Registro

### 2026-09-23

El buscador del sidebar se salía 40px por el borde con el sidebar en su mínimo (200px): el campo tenía un
ancho fijo de cuando compartía la fila con las casillas de estado, y el grupo no podía achicarse. Ahora
ocupa el ancho del sidebar y se achica con él; la prueba sin servidores lo mide a ese ancho, y con la
forma original falla con el mismo número que se midió en vivo.

Se retiró la sección fija de Harness de la evidencia —y `HARNESS_URL` del server— y la cronología pasó
a acordeón: cada día se pega arriba mientras se lee y se pliega con un clic. Tres defectos del pegado,
medidos en vivo y corregidos —uno en `taller.css`, compartido con harness y trazador—, y un chequeo
nuevo en la prueba sin servidores que falla si se revierte cualquiera de los dos arreglos propios.

Menos ruido: se retiró Jev del tablero —la orientación, la revisión de pendientes, el laboratorio y sus
dos rutas— dejando sólo la conexión con su API, y la fila de ramas al final de la evidencia. Se midió
cómo se usa la pila de contexto y quedó escrita la propuesta de un formato de adición, a decidir por
Miguel.

El cierre dejó de reclamar de más: la marca «sin avance» exime también la reescritura de la retoma, y un
`pull` a la rama base de un repo con barra en el nombre ya no cuenta como rama sin dueño.

El frente del código en inglés quedó cerrado: `tema.css` y `taller.css` quedan como nombres propios, por
decisión de Miguel, y así lo dicen `CLAUDE.md` y la lista de permitidos del chequeo de nombres.

Reinicio y prueba en vivo, a pedido de Miguel. La 4b anduvo sin sorpresas; la auditoría de contraste de
lo que se pinta, que por primera vez se pudo correr con el tablero arriba, encontró 51 nodos de texto bajo
AA más 10 que sólo se ven contando la opacidad de los ancestros. Se corrigieron con la rampa en vez de
opacidad, y la auditoría compartida aprendió a mirar la cadena entera.

Fase 4b: las claves JSON del tablero en inglés y el contrato en `tablero.task.v2`, con el server, la UI,
`jev.py`, el hook de cierre y el schema cambiados juntos. Para hacerlo y probarlo nacieron un inventario de
claves por AST, un renombrador de propiedades para Vue que respeta las clases CSS, un comparador de salidas
que traduce las claves viejas (`ab-json.sh`) y la huella de la interfaz vieja contra la nueva
(`ab-ui.sh`). `make tablero-naming` pasó a mirar también las claves, con excepciones por lugar.

La interfaz y lo que quedó muerto: el server se quedó con las rutas que la UI lee, y se fueron el
WebSocket, el guard servido, los ajustes, la escritura de tareas y bitácora, la consola de repos y
todo lo que colgaba de ellos (1.085 líneas netas de Go, 34 reglas de CSS, `tools/branches.py` y su
prueba). En la interfaz, cinco arreglos medidos con datos reales, y `make tablero-ui-offline` para que
no vuelvan. El README y `docs/ARCHITECTURE.md` describían el dashboard por WebSocket y un panel de
pestañas que ya no existían; se reescribieron.

Las tareas pasaron a ser carpetas: `tasks/<slug>/` con `task.md`, `context.jsonl` y `artifacts/`. Nació
`server/internal/layout`, que reemplaza seis copias de `dataDir()` y sabe seguir las mudanzas en git; el
store, los comandos, el server (ruta `/artifacts/<slug>/<archivo>`), los dos hooks y la documentación se
movieron con él. Al revisar los hooks apareció que el lint estaba apagado desde la fase 3; se arregló.

Fase 4: nace `make tablero-naming`, con la stdlib de Go y Python como vara del inglés y una lista de
permitidos por categoría. Al estrenarse encontró 13 nombres en español (25 declaraciones) que las fases anteriores no
habían visto; se renombraron con las mismas comparaciones de siempre. El detector de JS aprendió la
desestructuración y los valores por defecto, que eran su punto ciego.

Fase 3: las carpetas del tablero en inglés —siete de `server/`, el paquete del pulso y
`data/traps`— con el `Makefile`, los hooks, `package.json`, `jev.py` y 28 archivos de referencia en el
mismo cambio. El agente del pulso se reinstaló apuntando al binario nuevo y siguió escribiendo. Nació
`ab-make.sh`, que compara los targets de `make` y los hooks.

Fase 2: 26 archivos del tablero con nombre en inglés, movidos con `git mv`, y sus referencias en 16
archivos, incluido el import que hace el trazador de `citations.py`. `ab-py.sh` aprendió a invocar el
lado nuevo con los nombres nuevos y a comparar a través de ellos.

Fase 1b: el Python de `tools/` pasa a inglés (116 identificadores). Se sumó un renombrador de
Python a `tools/rename/py/` con las mismas garantías que los otros dos, y `ab-py.sh`, que compara las
herramientas contra un `git worktree` del commit anterior. Las corridas de `jev bench` para comparar
dejaron 8 reportes de previsualización en `.runs/jev`; se borraron.

Fase 1 del frente «el código en inglés»: Miguel decidió que `tablero` y los targets de `make` se
quedan y que el JSON va después. Se renombraron 1.035 identificadores de Go y ~235 de Vue/JS con dos
renombradores que usan el type checker y el AST, y que rechazan cualquier rename que sombree. Los
nombres de Go citados en `CLAUDE.md`, en el arnés y en el trazador se reapuntaron en el mismo cambio
(`store.Annotations`, `store.SourcesOf`, el regex `reAnnotation` que lee `anotacion.spec.ts`). Tres
archivos que no estaban en `gofmt` quedaron formateados. Verificado byte a byte contra el binario
anterior y con la interfaz vieja al lado de la nueva; el detalle está en el frente.

Validación completa del tablero: `go vet` limpio, `go test` verde en los 10 paquetes con pruebas
(ninguna saltada), 14 pruebas de Node, 18 de Python y el build de Vite pasan. Los lints propios
encontraron tres cosas: `estilo-check` falla por 5 colores literales en el resaltado SQL, el lint de
tareas marca `cuadrilla` (#93) fuera de los siete contenedores, y `make trampas` tiene una cita que ya
no existe en `main`. Además la retoma de esta tarea seguía describiendo `BRIEF=` contra `context/`,
que se apagó el 2026-09-21: se reescribió contra canon. Se abrió el frente «el código en inglés» con
su inventario medido.

### 2026-09-21

`make retomar` acepta `BRIEF=`: al final imprime la ficha de cada nodo de context declarado, corriendo
`context/tools/jev.py brief --text`, con tope de cuatro y `BRIEF=a,b` para elegir. Salió de medir el
arranque de una tarea: Jev no tenía nada que elegir —las 24 tareas vivas ya declaran nodos— y el gasto
estaba en abrir los `doc.md` (mediana 27 KB; `kyc` 55 KB). Un brief que falla queda como error en su
ficha; un nodo pedido que la tarea no declara se marca. Con `JSON=1` el brief viaja como JSON bajo
`context`. La regla de corte quedó en los tres `CLAUDE.md`: si la ficha no contesta, la pregunta va a
`workers/`, no a otro nodo.

### 2026-09-19

Se absorbió `tablero-retomar-en-frio` y se aplicó la consolidación de todas las tareas locales. La
API ya no crea tareas locales sueltas; el CLI también las detecta y hace fallar el lint.

La tarea ahora tiene una proyección JSON tipada y generada desde el Markdown. Expone el estado
operativo sin copiar todo el cuerpo privado y deja el texto largo como evidencia consultable.

La consola de ramas pasó al panel inferior del Tablero, abierta por defecto y recuperable desde el
pie. Después se retiró la vista duplicada del sidebar derecho y se acotó el selector a los repos de
la tarea enfocada. Las tareas locales y de Jira recibieron rutas hash estables que sobreviven a la
recarga. La pulida responsive prioriza la lectura, fija la identidad de cada rama al desplazar la
tabla y vuelve explícitos los pendientes, la antigüedad de la medición y los estados de ambientes.
