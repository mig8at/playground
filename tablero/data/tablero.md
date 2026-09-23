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
sidebar derecho ya no repite una ficha de detalle: usa pestañas para Jira, pendientes, hallazgos,
registro, bitácora y prototipos. Jira abre primero, ocupa todo el alto y muestra la descripción sin
marco de tarjeta. En ventanas medianas el sidebar se pliega y se recupera desde el pie.

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

El laboratorio Jev de tablero está apagado por defecto. Sobre una retoma mínima pregunta en paralelo
el siguiente tipo de acción, el bloqueo externo y la urgencia. El banco sintético repetido dio 16/16
en las tres etiquetas, con 15 sugerencias y una revisión manual; una retoma real quedó etiquetada en
preview y no se envió.

`make retomar N=<id> BRIEF=1` suma al final la ficha de cada tema de canon que la tarea declara en
`canon:`, hasta cuatro; `BRIEF=a,b` elige. La ficha sale de `GET /api/read` de canon (no de un modelo)
y decide qué `context.md` se abre, no lo reemplaza.

**Frente abierto (2026-09-23): el código del tablero pasa a inglés — identificadores, archivos y
carpetas.** Pedido de Miguel; extiende a esta herramienta la regla que ya regía en los repos de la
compañía (identificadores en inglés, comentarios en español). El contenido de `data/` —las tareas, sus
títulos de sección y el frontmatter que se escribe a mano— **no** entra: es texto, no código. Detalle,
fases e inventario en «Frente: el código en inglés», abajo.

**Estado (2026-09-23):** fase 0 decidida —`tablero` y los targets de `make` se quedan; el JSON de la
API va en una tanda aparte— y **fase 1 hecha**: 1.035 identificadores de Go y ~235 de Vue/JS en inglés,
con las salidas de consola (32 invocaciones) y de la API web (17 GETs) idénticas byte a byte contra el
binario de antes, y la interfaz vieja y la nueva dando la misma huella en 36 pasos de clics. **Fase 1b
hecha** el mismo día: 116 identificadores del Python de `tools/`, con las 11 salidas de sus herramientas
idénticas al código anterior. **Fase 2 hecha** también: 26 archivos renombrados con `git mv`
(`store/annotations.go`, `tools/citations.py`, `TASK-TEMPLATE.md`, `docs/ARCHITECTURE.md`…). Quedan en
español, a propósito: las claves JSON, `schemas/tarea.v1.schema.json` (lleva el nombre del contrato,
va con la 4b). **Fase 3 hecha**: `cmd/{today,closeout,branches,tasks,worklog,pulse}`,
`internal/pulse` y `data/traps`, con el LaunchAgent del pulso reinstalado sobre `bin/pulse` y
escribiendo. Quedan como nombres propios `cmd/cuadrilla`, la etiqueta del agente
(`com.creditop.tablero.pulso`) y su log. **Fase 4 hecha**: `make tablero-naming` frena un nombre nuevo
que no es inglés, y al estrenarse encontró 13 nombres en español (25 declaraciones) que las fases 1–3 no habían visto; se renombraron.

**El próximo paso es:** decidir cuándo va la 4b —las claves JSON de la API y `schemas/tarea.v1.schema.json`,
que cambian juntas porque son contrato con la interfaz, los hooks y `tablero.tarea.v1`— y qué hacer con
`tema.css`/`taller.css`, que son compartidos con harness y trazador.

> **MEDICIÓN · 2026-09-19** — sobre la tarea KYC #47, el Markdown completo pesa 64.571 bytes; la proyección compacta pesa 6.243 bytes (**90,3 % menos**) y la variante con borrador 11.856 bytes.
> make tarea-json N=47; make tarea-json N=47 CONTENIDO=1; wc -c

> **MEDICIÓN · 2026-09-21** — sobre la tarea KYC #47: la retoma pesa 3.832 bytes; con `BRIEF=1` 18.540 bytes (sus tres fichas) contra 96.313 de sus tres `doc.md` (**80,8 % menos** que abrirlos). La ficha de `kyc` sola: 5.074 bytes contra 55.302 de su doc. Las 24 tareas vivas declaran `context_nodes`: al retomar no hay nodo que elegir, así que Jev `route` ahí no ahorra nada.
> make retomar N=47; make retomar N=47 BRIEF=1; cat context/server/data/flows/{kyc,credifamilia,deceval}/doc.md | wc -c

## Pendientes

- [ ] **El cierre pide bitácora por una tarea que sólo recibió un barrido de rutas.** Medido el
      2026-09-21: mudar las trampas del sistema cambió UNA línea en `#46` y `#47` —la ruta del
      archivo, nada del trabajo— y el cierre exigió bitácora del día en las dos. Anotar minutos ahí
      sería inventar tiempo, y ese dato sube a Jira. El caso análogo ya está resuelto para el
      frontmatter (`metadataOnly`, que no reclama cuando lo único que cambió es un metadato);
      falta el equivalente para un cambio que **no toca ninguna afirmación** de la tarea. Una pista
      barata: si el diff del cuerpo son sólo rutas o enlaces, no es trabajo.

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
- [ ] Nombres en inglés · fase 4b: las claves JSON de la API y `schemas/tarea.v1.schema.json`, con el
      contrato subido a `tablero.tarea.v2`; termina con la interfaz, los hooks y `make tarea-json`
      leyendo las claves nuevas. Depende de: Miguel — cuándo.
- [ ] Decidir `tema.css` y `taller.css`: son españoles pero compartidos con harness y trazador (fuente
      en `tools/ui/`); termina cuando se renombran en las tres a la vez o se declara que se quedan.
- [ ] Sacar los 5 colores literales del resaltado SQL de `src/App.vue` a tokens; termina cuando
      `make estilo-check` sale 0 (hoy falla sólo por eso, chequeo 6).
- [ ] Resolver el contenedor `cuadrilla` (#93): el lint lo marca fuera de los siete nombres
      canónicos; termina cuando `make tareas TODAS=1` no muestra el ⚠ — sumándolo a la lista o
      absorbiéndolo en `playground`.
- [ ] Actualizar `docs/ARCHITECTURE.md`: su «Recorrido diario» describe un panel con pestañas
      Trabajo, Hallazgos y Ramas que ya no existe; termina cuando coincide con la tabla de regiones de
      `CLAUDE.md`.
- [ ] Comprobar que ninguna tarea local nueva nazca fuera de los siete nombres canónicos.
- [ ] Confirmar que bitácora y retoma siguen agrupadas bajo la herramienta correcta.
- [ ] Medir cuántos archivos y tokens evita `make tarea-json` en una retoma real con workers.
- [ ] Reunir una muestra representativa de etiquetas antes de comparar Jev con trabajo real.
- [ ] Medir, en una semana de retomas reales, cuántas veces la ficha de `BRIEF=1` alcanzó y cuántas se abrió el doc igual — si es siempre, la ficha no está decidiendo nada.

## Frente: el código en inglés

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

   ✔ Hecho el 2026-09-23: `tools/naming.py`, cableado en `make tablero-naming` y probado por
   `make tablero-naming-test`.

   > **MEDICIÓN · 2026-09-23** — el chequeo lee 4.836 nombres de Go, 1.390 de Vue/JS, 863 de Python y 182 rutas. Con cuatro sondas inventadas (`leerTareaVieja` en Go, `guardarNota` en JS, `cargar_fecha` en Python y `zz-notas-viejas.md`) salió 1 y nombró las siete, incluidas `antes` y `texto`, que el diccionario del sistema acepta; sin ellas, 0.
   > make tablero-naming; make tablero-naming-test

   > **MEDICIÓN · 2026-09-23** — al estrenarse encontró 13 nombres en español, en 25 declaraciones, que las fases 1–3 no habían visto: en Go `en` (siete, «está en» un ambiente), `ya`, `es` y `del`; en Vue/JS `vistos`, `nodo`, `ancla`, `fijar`, `restaurarFoco`, `horas`, `clave`, `CEL`, `JHL`. Se renombraron (mapas en `tools/rename/maps/phase4-*.tsv`) con la consola 32/32 y la API 17/17 iguales al binario anterior, y en la interfaz los enlaces a canon, el menú de avance con su foco, la pestaña fijada y la grilla de la jornada se comprobaron andando.
   > tablero/tools/rename/ab-cli.sh <árbol-anterior> && tablero/tools/rename/ab-web.sh

   > **RIESGO · 2026-09-23** — por qué la fase 1 se los saltó: el detector de JS sólo contaba como declarado lo que crea un `const x` o un parámetro simple, no una desestructuración (`const [nodo, ancla] = …`) ni un parámetro con valor por defecto (`fijar = false`). El renombrador heredaba el mismo punto ciego. Hoy los dos usan `tools/rename/js/decls.mjs`. La lección es la del `CLAUDE.md` raíz, «una es la vara de otra»: el chequeo tiene que ser independiente de lo que se usó para renombrar, o repite sus huecos.

   > **DECISIÓN · 2026-09-23** — `schemas/tarea.v1.schema.json` y `src/tema.css` se aceptan en español con su motivo en `tools/naming-allow.txt`: el primero cambia con el contrato (4b); el segundo es compartido con harness y trazador. `src/taller.css` es el mismo caso y el chequeo no lo ve, porque `taller` también es inglés: es el límite conocido de la vara.

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

## Cómo se comprueba

`make tareas TODAS=1`, `make tarea-json N=tablero`, `make tablero-jev-test`, los tests del servidor
(`go test ./cmd/hoy/` cubre el tope y los errores de `BRIEF=`), `make retomar N=47 BRIEF=1` y
`make cierre JSON=1`.

## Registro

### 2026-09-23

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
