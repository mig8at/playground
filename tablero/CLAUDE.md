# tablero — protocolo (las TAREAS a realizar)

Qué es y cómo se corre: `README.md`. Acá sólo las reglas al trabajar con las tareas. Lo demás vive en
skills que se cargan cuando hacen falta:

| al tocar… | skill |
|---|---|
| la interfaz del tablero (Vue, regiones, rutas, preferencias) o su código (nombres en inglés) | **`tablero-ui`** |
| ramas y ambientes de una tarea, despliegues, Sonar, crear o mover un issue de Jira | **`tablero-delivery`** |
| canon: leerlo o dictarle una regla | **`canon`** (en la raíz) |

## Una tarea es una carpeta

`tasks/<slug>/` con su documento `task.md`, su pila `context.jsonl` y sus `artifacts/`. `data/` es lo
operativo: bitácora, pulso, cachés y las trampas del sistema. **Dónde vive cada cosa lo sabe un solo
lugar: el paquete `server/internal/layout`**; no armes `../data/<algo>` a mano en un comando.

- ⚠ **Antes de crear cualquier archivo, corré `make tareas TODAS=1`.** Una tarea de producto o del equipo
  es un archivo ligado a Jira; para trabajo local casi siempre hay que editar uno de los **ocho
  contenedores permanentes**: `canon`, `context`, `harness`, `tablero`, `trazador`, `workers`,
  `playground` y `playground-local` (#96: lo transversal a las herramientas). `context` y `workers` quedan
  por su historia. El lint y `make tareas` validan esta lista.
- **Los contenedores son `clase: proyecto`**: sin Jira ni sección publicable. Dentro, cada frente conserva
  objetivo y condición de cierre; al terminar, lo que pasó queda en un bloque y el frente sale de los
  pendientes. No apiles una tarea nueva por cada mejora de la misma herramienta.
- **Frontmatter**: `id` · `title` · `clase?` (`tarea`|`proyecto`) · `stage` (`evaluation`|`work`|`tasks`) ·
  `created` · `archived?` · `canon[]` · `jira[]` · `jira_title` · `ramas?`. Archivar es poner `archived`,
  no mover el archivo. **`id: 0` no aparece en el tablero.**
- **Renombrar o mover una tarea NO es tocarla**: «días sin tocar» y el cierre siguen las mudanzas de git.
- **JSON es una proyección, no otro archivo**: `make tarea-json N=<slug|id>` deriva `tablero.task.v3` del
  Markdown y la pila. No crees sidecars manuales.
- `data/entries/` (bitácora), `data/pulse/` (el pulso) y `data/cache/` están **fuera de git** a propósito;
  `tasks/` **sí** se versiona.

## CINCO piezas, cinco preguntas distintas

El título es lo único compartido; el resto no se repite entre piezas. Dónde va algo lo decide **quién lo
lee y qué necesita**:

| pieza | contesta | la lee |
|---|---|---|
| `title` / `jira_title` | ¿cómo se llama esto? | todos |
| **el documento** (privado) | ¿cómo se está atacando? los caminos evaluados, los descartados y por qué | vos, y un modelo que retoma |
| **la pila** (`context.jsonl`) | los HECHOS con fecha: qué pasó, qué se midió, qué se decidió | quien vuelve semanas después |
| **avances** (`data/entries/`) | ¿en qué se fue el tiempo? | vos, y el worklog de Jira |
| **`## Tarea (publicable)`** | qué problema resuelve (producto) y cómo se prueba (QA) | el equipo, vía Jira |

**El test de enrutamiento: *si esto se mergea mañana, ¿sigue siendo cierto?*** Sí y es del sistema →
**canon**. Sí y es de la tarea → el documento. No → un **bloque** de la pila. Una trampa del sistema
(síntoma → causa → evidencia → arreglo) → `data/traps/doc.md`, no la tarea. Al mergear, lo aprendido
**gradúa** a canon y la tarea se archiva.

### El documento

La forma está en `TASK-TEMPLATE.md` (en la raíz de `tablero/`, NO en `data/`: ahí todo `.md` se lee como
tarea). Copiala para una tarea nueva. El orden es el que necesita quien llega sin contexto:

    Pendientes                                 ← casillas concretas, lo abierto y lo cerrado
    Objetivo · Dónde se toca · Cómo se ataca
    Lo que se evaluó y NO se eligió            ← evita re-proponer lo que ya falló
    Lo que NO entra · Cómo se comprueba        ← la RECETA, que se mantiene
    Referencias
    ## Tarea (publicable)                      ← de acá abajo, lo único que sale a Jira

- **El documento no lleva historia**: ni `## Registro`, ni `## Bitácora`, ni anotaciones fechadas
  (`> **MEDICIÓN · fecha** — …`), ni «próximo paso». Lo que pasó va a la pila; el lint frena lo nuevo y
  dice adónde va. El documento se **reescribe** cuando cambia lo vigente: objetivo, plan, pendientes.
- **Lo que se evaluó y se descartó va aunque no se haya elegido**: es lo que evita re-discutirlo.
- **Pendientes**: una lista canónica bajo `## Pendientes`. Cada casilla empieza con una acción y dice cómo
  se sabe que terminó; una dependencia agrega `Depende de: <quién> — <qué>`. Marcá sólo lo verificado.
- **Tener fecha no condena a una sección**: «Cómo se prueba (verificado el …)» es material vigente. El
  test es el de arriba. `make anatomia` mide el peso de cada documento y señala secciones con fecha que
  parecen historia; no mueve nada. El lint, a propósito, no avisa por tamaño.
- **Las tareas ya publicadas NO se migran** (decisión de Miguel, 2026-08-20).

### La publicable: dos mitades, y la plantilla ya existe

    ## En una línea · ## Por qué · ## Qué cambia · ## Alcance          ── producto
    ## Dónde probar · ## Cómo validar · ## Cambios en datos
    ## Criterios de aceptación · ## Dependencias / contraparte        ── QA

**No es un resumen del documento**: es otro público. El documento dice cómo se resuelve; la publicable,
qué se logra y cómo se verifica. «Dónde probar» nombra **el ambiente concreto** (dev, qa y staging se ven
iguales porque comparten la base). Basta la mitad de QA para una tarea chica. Los proyectos no llevan
publicable. ⚠ Al medirla, **va del marcador hasta el FINAL del archivo**: sus subtítulos son `##`, del
mismo nivel que el marcador.

**La frontera del guard está DENTRO del archivo.** Sólo salen a Jira `jira_title` y la publicable, y pasan
el guard (`connectors/guard`), que rechaza F-xx, repos, rutas con extensión, `playground` y el
vocabulario de las herramientas (`make <target>`, `E2E_TARGET`, `trazador`, `localhost`…). **Se comparte
QUÉ se hizo, no CON QUÉ**: *«se recorrió el flujo de punta a punta con un cliente de prueba»*, nunca el
comando. `make tareas-guard F=<archivo>` lo prueba antes de escribir (sale 1 si no pasa). El guard no es
la regla de qué escribir, sólo de qué no filtrar: un texto lleno de SQL y clases de Laravel lo pasa.

**Editar el archivo no publica nada**, y **nada se publica sin que Miguel lo vea antes**. La pestaña Jira
muestra lo recibido de Jira, no el borrador.

### La pila de bloques

Cada bloque es un hecho con fecha: un **título** de una línea —la conclusión, no la actividad: «la regla sí
excluye», no «revisé la regla»— y una **descripción** en prosa que nombra lo que la sostiene. Una
decisión o un riesgo arrancan diciendo qué son («**Decisión.** …»). **No hay «siguiente paso»**: si se
decide uno, entra como bloque o como pendiente. Una pregunta a alguien es además un pendiente con
`Depende de:`.

| Qué se nombra | Cómo se escribe | Qué comprueba el validador |
|---|---|---|
| un tema de canon | `[texto](canon:tema#ancla)` | que canon lo conozca (sin red, entra con aviso) |
| un paso de un recorrido de canon | `[Firma](canon-ruta:codeudor/renting#renting-codeudor)`; sin `#paso`, la variante | que existan tema, variante y paso (`make canon-route REF=…`) |
| un archivo | `[texto](repo:<repo>/<ruta>#L12)`, nunca una ruta local | que el repo se pueda citar y la ruta exista; **lo fija al commit** |
| un PR · un issue | `[#1140](pr:legacy-backend#1140)` · `[CORE-431](jira:CORE-431)` | que el repo se pueda citar |
| otro bloque | `[el de ayer](bloque:<id>)`: así se corrige uno sin editarlo | que esté en la pila |
| una pantalla del diseño | `[Completa tu solicitud](visor:<clave>/<nodo>@<huella>)`, como lo da el visor | la forma (`make visor-enlaces` dice si cambió) |
| una página | `[texto](https://…)` | nada |
| una prueba | ` ```harness ` o ` ```trazador ` con el comando, y debajo `Resultado: …` | que el comando diga su `TARGET=` |
| una consulta | ` ```sql prod ` con el `SELECT`, y debajo `Resultado: …` | ambiente presente y sólo lectura |
| otro comando | ` ```sh `, y debajo `Resultado: …` | que lleve su resultado |

⚠ **Va el COMANDO, no la conclusión**, y el validador lo exige: sin comando y resultado, un número no se
puede volver a tomar ni desmentir. Rechaza además rutas locales, archivos sin repo, SQL que escribe, HTML
y títulos de más de una línea. Los repos citables salen de `tools/repos.json`, más `playground` y
`playground-equipo`. El material que no es un comando va en ` ```json ` o ` ```text `.

Se escribe en un Markdown (`# título` y la descripción) y se agrega con `make tarea-bloque N=<id|slug>
ARCHIVO=<bloque.md>` (`SECO=1` previsualiza; `ARCHIVO=-` lee stdin). **Las herramientas lo hacen solas
con `BLOQUE=<id|slug>`**: `harness-case` · `-listing` · `-walk-wizard` · `-suite`, `trazador-ureq` ·
`-buscar` · `-sql` y `tablero-db`. `MD=1` da la anotación para un documento que no es una tarea. Se lee
con `make tarea-context N=…` o `make retomar`. El contrato de la línea: `docs/task-context.schema.json`.

⚠ **El server valida la pila también al LEERLA, con su propio código**: después de agregar un tipo de
enlace, reiniciá el tablero, o la pila entera de esa tarea se ve vacía.

**Un hallazgo** (lo que le pasó a ESTA tarea) es un bloque y muere con ella; **una trampa** (`F-xx`, lo que
le pasa al sistema) vive en `data/traps/doc.md` y se entra por su síntoma. `make trampas` las valida.

### Avances y artifacts

- **Avances** (`data/entries/`): una entrada por tramo de trabajo, append-only, en la forma **acción
  realizada → resultado → validación**. Se escriben con `make bitacora-add TAREA=<id>` y una fuente de
  tiempo. La pila cuenta qué pasó; los avances, cuánto llevó.
- **Artifacts** (`tasks/<slug>/artifacts/`): prototipos, consultas, notas. Un prototipo es **un HTML
  autocontenido, sin build**, **con la fecha visible adentro**, y **no gradúa a canon**: describe lo
  propuesto y muere con la tarea.
- **`ramas:`** en el frontmatter declara sólo los PATRONES; dónde vive cada rama lo mide `make
  tareas-ramas` (skill `tablero-delivery`). Si el trabajo no tiene rama propia, no inventes un patrón.

## AL CERRAR UNA SESIÓN: tres cosas

1. **Un bloque del día** con `make tarea-bloque`, en la tarea con `id`: el título con la conclusión y la
   descripción con lo que la sostiene. Lo descartado entra como bloque con su motivo.
2. **`ramas:`** apenas exista la primera rama, y volvé a medir con `make tareas-ramas`.
3. **La bitácora con `make bitacora-add`**, con los minutos de UNA fuente que queda escrita en la nota:
   `LAPSO=HH:MM-HH:MM`, `PULSO=HH:MM` o `MIN=N FUENTE='…'`. ⚠ **Los minutos se MIDEN, no se estiman**:
   suben a Jira. Si el pulso no tiene datos, decí de dónde salió el número.

**`make cierre` lo chequea** (sale 1 si a una tarea tocada le falta una pieza) y el hook de `Stop`
(`closeout`) lo corre solo, una vez por sesión, sobre las tareas que ESA sesión escribió. Si te frena en el
medio del trabajo, decilo en una línea y seguí.

- **Cambiar sólo el frontmatter no es trabajar en la tarea**: el cierre no reclama nada.
- **Un barrido tampoco**: el commit lo declara con un trailer, y el cierre no le pide bloque ni bitácora
  (se declara, no se deduce):

      git commit -m "tablero: la ruta a las trampas cambia de carpeta" \
                 -m "Sin-avance: sólo se reapuntó la ruta a las trampas del sistema"

- Si la tarea declara `ramas:` y no hay un solo comando reconocible en ella, el cierre avisa `▲ tocó
  código y no dice con QUÉ se comprobó`. Avisa, no frena.

**El pulso** (`server/cmd/pulse`, un LaunchAgent cada 5 min) anota solo cuándo se tocó código leyendo git;
no se escribe a mano. Se lee con `make pulso`. El pulso dice **cuándo**; la bitácora, **en qué**.

## Retomar una tarea

`make tareas TODAS=1` → `make retomar N=<id>`: la pila primero (el último bloque entero, con sus archivos
fijados a su commit) y lo que tenga el documento. Con eso, una hipótesis verificable. Después, `canon:`:

1. **Hay referencias:** `make retomar N=<id> BRIEF=1` trae la **ficha** de cada una (hasta cuatro;
   `BRIEF=a,b` elige), derivada de la API de canon sin llamar a un modelo. La ficha decide qué abrir; no
   reemplaza la lectura. Preferí una cita exacta (`tema/context#ancla`) sobre un tema entero.
   **`CANON=1`** trae ya las SECCIONES enteras que el título y el resumen de la tarea encuentran dentro de
   esos temas, leídas de la copia local (sin red ni modelo, 12 KB; lo que no entra sale por su cita), y
   avisa si la tarea declara un tema que canon no tiene — canon lo ignora en silencio. `CANON_Q='…'` busca
   otra cosa.
2. **No hay, o el pedido es general:** una pregunta técnica sin datos de caso a canon (`make canon-search`).
   Una sugerencia no se copia sola al frontmatter: se confirma leyendo.
3. **La pregunta es de una persona, una solicitud o una medición actual:** ningún corpus la contesta. Va el
   trazador o el harness, y la evidencia se registra con su comando.

⚠ **La regla de corte: si la ficha del tema no contesta, no se prueba otro tema — la pregunta va al código
de `main`.** El silencio del corpus es su modo de falla conocido, y una búsqueda devuelve el tema más
parecido con buena puntuación. Una referencia que cambió el curso de la tarea se cita en el bloque que la
usó (`[texto](canon:tema#ancla)`).

## Cuando aparece una regla de negocio

Trabajando una tarea aparecen reglas que la tarea no inventó (cómo se calcula un monto, quién queda afuera
de un listado). **Cada una pasa por esto, sin que nadie lo pida** (Miguel, 2026-09-23):

1. **¿Canon la tiene?** `make canon-search` → `make canon-read`. Si coincide, se cita y el tema entra a
   `canon:`. Si **contradice** el código, se reescribe esa sección, no se agrega otra al lado.
2. **Si no, ¿es real y está viva?** Delegalo al subagente **`main-verifier`**, o a mano: `git show origin/main:<ruta>` en **los dos monolitos**, `git log -S`
   para saber desde cuándo, y que el código se alcance. Si se puede, se mide en prod con el trazador.
3. **Si es viva, va a canon** con el filtro de `skills/dictar.md`: existe en `main`, sin crónica, sin nada
   de un PR abierto. Las recetas, en la skill **`canon`**.
4. **Queda en la tarea** un bloque con qué regla era, con qué se verificó y su cita. Sin la VPN de prod, la
   pieza queda en `artifacts/` y un pendiente «Publicar en canon»: no está documentada hasta que aparezca.

⚠ **No es lo mismo que graduar**: graduar pasa lo que la tarea CAMBIÓ, al mergear; esto es lo que
ENCONTRÓ que ya existía, y no espera.

## De dónde sale lo que se escribe acá

| herramienta | contesta | deja en la tarea |
|---|---|---|
| **canon** | lo que ya se sabe del sistema, compartido con el equipo | `canon:` al abrir · una graduación al cerrar |
| el código de `main` | lo que nadie escribió | **«Dónde se toca»**: archivos con el porqué |
| [`harness/`](../harness/CLAUDE.md) | ¿funciona, corriéndolo? | **«Cómo se comprueba»**: el comando, no la conclusión |
| `tablero-db` | ¿qué dicen los datos en un ambiente? | la consulta SQL de sólo lectura, con su ambiente |
| [`trazador/`](../trazador/CLAUDE.md) | ¿cómo se comportó una solicitud concreta? | la traza o la medición de esa solicitud |

## El tablero por consola, sin levantar nada

    make tareas                       las abiertas, con etapa, Jira y nodos
    make tareas N=kyc-segundo         una: separa lo PÚBLICO de lo PRIVADO y chequea el guard
    make tareas STAGE=work TODAS=1 JSON=1
    make tarea-json N=tablero         una tarea —documento y pila— en el contrato `tablero.task.v3`
    make tareas-guard F=<archivo>     ¿este texto puede salir a Jira? SALE 1 si no
    make sprint                       el sprint activo con puntos, del SNAPSHOT
    make bitacora DAYS=7              el tiempo registrado, por día
    make tareas-ramas                 en qué ramas vive cada tarea y hasta dónde llegó (mide git)
    make hoy                          la agenda: último bloque, preguntas vencidas, entrega, dormidas
    make retomar N=84                 retomar UNA en frío. BRIEF=1 suma la ficha de canon
    make cierre                       el cierre del día: a qué tarea tocada le falta qué
    make bitacora-add TAREA=84 …      la bitácora con minutos medidos por el comando
    make tarea-bloque N=84 ARCHIVO=…  apilar un bloque validado
    make tarea-context N=84           leer la pila de una tarea
    make deploys FALLAS=1             sólo lo que falló en los despliegues, con el error del log
    make jira-create JSON=t.json      crear en Jira y meter al sprint activo (skill `tablero-delivery`)
