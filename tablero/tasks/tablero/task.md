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

## Pendientes

- [x] ~~Sacar la LISTA de repos a un archivo de datos~~ — `tools/repos.json`, leída por
      `internal/repos` (Go, nativo: el server ya no levanta Python) y por `tools/repos.py`, que quedó
      como envoltorio de `cmd/repos` hasta que workers pase a Go. Comparado contra el Python viejo: la
      lista, las 12 refs, los 7.661 archivos de la ref, `web` y 7 citas dan lo mismo, y `make trampas`
      y seis comandos de workers salen idénticos.
- [x] Pasar a Go el validador de citas y el de trampas — `internal/citations` + `internal/traps`, con
      `make trampas` y `make citas DOC=…`; `citations.py` y `traps.py` borrados. Contra el Python, sobre
      119 documentos y 995 citas con todos los baldes, la salida es idéntica byte a byte, con y sin
      `-ok`.
- [x] Pasar a Go el chequeo de nombres — `internal/naming` + `cmd/naming`, que absorbe los extractores
      `rename/go/cmd/{decls,json-keys}` (`-decls`, `-json-keys`: salida idéntica, 5.979 y 897 líneas).
      Con la lista de permitidas vaciada un momento, los 332 hallazgos salen iguales en los tres modos, y
      la tabla de frecuencias es la misma (44.131 palabras). `naming.py` y `test_naming.py` borrados.
- [x] Pasar a Go los cinco hooks — `internal/hooks` + `cmd/hooks`, llamados por `.claude/hooks/run`
      (sh: compila cuando cambia el código; 16 ms por llamada). Contra el Python: 4.000 comandos a la
      guarda (979 frenados), 3.000 `shlex`, 24.031 piezas de 29 transcripts reales y el bloqueo del
      cierre salen iguales, salvo 188 comandos donde Go frena y Python no: los dos huecos que tenía la
      guarda (raíz con `~`/relativa; cwd en un worktree, que la hacía rendirse), cerrados con prueba.
      Ninguno al revés.
- [ ] Terminar de pasar el Python del playground a Go (pedido de Miguel, 2026-09-23), cada pieza
      borrada sólo después de salir idéntica contra la vieja: `tools/{confluence,estilo,ui-sync}.py` y `trazador/tools/huella.py` · `workers/` (~7.100 líneas, que es lo que mantiene vivo `tools/repos.py` y `tools/canon.py`) ·
      (`twilio/` pasó a `connectors/twilio` y `flow/` salió del repo a `~/Desktop/CREDITOP/temp/`, los dos el 2026-09-24). Termina cuando `git ls-files '*.py'` no
      devuelve nada fuera de lo que se decida conservar (hoy `jev_transport.py`, la conexión con Jev).
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

1. **Identificadores** (Go y Vue/JS). ✔ Hecho el 2026-09-23. El contrato de afuera no se movió: las
   etiquetas JSON, los campos sin etiqueta que se serializan por nombre (se comprobó uno por uno) y
   las claves de objeto del front siguen en español, porque son la fase 4b.

1b. **El Python de `tools/`.** ✔ Hecho el 2026-09-23.

2. **Archivos.** `git mv` para no perder la historia. ⚠ El arnés busca `anotaciones.go` y
   `reAnotacion` por nombre: se reapunta `harness/pkg/anotacion.spec.ts` en el MISMO commit, o su
   prueba falla — y si falla por «no encontré», se lee como un rename, no como un error.
   ✔ Hecho el 2026-09-23: 26 archivos. Los mapas de la fase 1 pasaron a `maps/phase1-*.tsv`.

3. **Carpetas.** `server/cmd/*` cambia el nombre del binario: `Makefile`, los dos hooks y el plist
   del LaunchAgent (`bin/pulso`) van juntos. ⚠ Un pulso que deja de escribir no avisa: se lee como un
   día sin trabajo.
   ✔ Hecho el 2026-09-23: `cmd/hoy→today`, `cierre→closeout`, `ramas→branches`, `tareas→tasks`,
   `bitacora→worklog`, `pulso→pulse`, `internal/pulso→internal/pulse` (el paquete también) y
   `data/trampas→data/traps`. Los targets de `make` no cambiaron.

4. **Cablearlo.** Un chequeo en `make` que falle con un identificador nuevo en español (lista de
   raíces del dominio: tarea, rama, pendiente, anotación, fuente, retoma, cierre…), porque una regla
   escrita envejece y un chequeo no.
   4b. Si la fase 0 lo decide: etiquetas JSON, con el contrato subido a `tablero.tarea.v2`.

   ✔ **4b hecha el 2026-09-23**, a pedido de Miguel («Dale continua»). El contrato se llama
   `tablero.task.v2` y no `tablero.tarea.v2` como decía este plan: su nombre es un identificador, y la
   regla es la misma que para el resto.

   ✔ Hecho el 2026-09-23: `tools/naming.py`, cableado en `make tablero-naming` y probado por
   `make tablero-naming-test`.

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

**Lo que no se hizo.** No se pudo mirar la interfaz andando: el lanzador de previews de esta sesión no dejó arriba los servidores de prueba. La API que la alimenta y la ruta de los artifacts sí se comprobaron (incluido que no deja salir de la carpeta con `..`). Quedan con la ruta vieja, a propósito, las anotaciones fechadas de otras tareas y las memorias que ya apuntaban a tareas que no existen.

## Frente: la interfaz y lo que quedó muerto

**Objetivo.** Pedido de Miguel el 2026-09-23: mejorar la interfaz y sacar lo que quedó muerto y no se va
a usar. «Muerto» se midió, no se opinó: una ruta del server sin nadie que la llame (la UI, las
herramientas, los hooks), una función que `deadcode` no alcanza desde ningún `main`, un campo que se
asigna y nadie lee, una regla de CSS cuyo selector no puede coincidir con nada.

**Lo que no se hizo.** `tema.css` y `taller.css` siguen sin decidir, y `jira-preview.js` conserva sus
colores literales a propósito: es un documento aislado dentro de un iframe, donde los tokens del tema no
llegan.

## Frente: la pila de bloques (diseño acordado el 2026-09-23; los cinco pasos hechos)

**Objetivo.** Pedido de Miguel: que la tarea sea una pila de BLOQUES de documentación que entran con el
tiempo, sin una estructura fija más que el bloque mismo. Una tarea limpia está vacía.

**El bloque.** Muestra dos cosas: un **título** —una línea, la conclusión y no la actividad— y una
**descripción** en prosa libre. Adentro de la descripción van enlaces con tipo —`canon:`, `repo:`
(repo y ruta, nunca una ruta local), `pr:`, `jira:`, `bloque:` y `https:`— y comandos en bloques de
código etiquetados —`harness`, `trazador`, `sql <ambiente>`, `sh`—, cada uno seguido de su
`Resultado:`. Internos, en el JSON y sin mostrarse: `id`, `at` —la fecha, que sólo agrupa los bloques
en el acordeón Hoy · Ayer · fechas— y `via`, quién lo agregó.

**Qué rechaza el validador.** Una ruta local; un archivo sin su repo; un repo fuera de
`tools/repos.py` (la fuente única, no una copia); una ruta que no existe en la ref de ese repo; un
tema de canon que canon no conoce; un comando `harness`/`trazador` sin `TARGET=`; un comando sin su
`Resultado:`; SQL que escribe o sin ambiente; HTML; un título de más de una línea.

**Plan por pasos, hecho.** (1) el bloque existe: formato, validador, `make tarea-bloque` y su vista en la
cronología; (2) los hitos viejos pasan a bloques y el formato se retira; (3) `make cierre`, `make hoy` y
`make retomar` sobre bloques, sin «próximo paso»; (4) harness, trazador y consultas DB agregan su bloque
(`via`); (5) la historia del documento —anotaciones, Registro y retoma— pasa a la pila, el lint frena una
nueva, `tarea-json` pasa a v3 con la pila adentro y el «sin avance» se declara en el commit del barrido.

**Lo que quedó afuera del paso 5, a propósito.** La «Bitácora» de #67, archivada: las tareas ya publicadas no
se migran (Miguel, 2026-08-20), y el lint sólo le avisa. #94 y #95 esperaron a que terminara la sesión que
las editaba y se migraron el mismo día, a las 17:30 y a las 17:52. Las secciones fijas del documento
(objetivo, plan, material) siguen siendo plantilla: moverlas también a la pila sería otro paso, y no se
decidió.

## Cómo se comprueba

`make tareas TODAS=1`, `make tarea-json N=tablero`, `make tablero-jev-test`, los tests del servidor
(`go test ./cmd/today/` cubre el tope y los errores de `BRIEF=`), `make retomar N=47 BRIEF=1`,
`make cierre JSON=1`, `make tablero-ui-offline` (la interfaz sin servidores) y `make estilo-check`.
La pila: `make tarea-context N=<id>` la lee con el validador, y `tareas -lint <task.md>` frena en el
documento un registro con fecha nuevo (`go test ./cmd/tasks` lo prueba contra un repo de juguete).
