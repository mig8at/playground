# context — protocolo de curación del árbol

Qué es el árbol y cómo se lee: `README.md` + `docs/ROUTE-MAP.md`. Acá solo el protocolo.

## Rutina diaria del agente: mapa → evidencia → tarea

`CLAUDE.md` es la memoria compartida de este proyecto: un agente que empieza dentro de `context/`
recibe estas reglas antes de investigar. Su primera responsabilidad no es adivinar una causa ni abrir
todo el monorepo; es reducir la búsqueda sin convertir una sugerencia en un hecho.

1. **Ubicá el trabajo.** Si la tarea vive en `tablero/data/`, abrí su frontmatter y leé
   `context_nodes:`. Esos son los nodos que se consultan primero. Si no hay tarea aún, tomá de la
   petición la pregunta técnica, no identificadores de una persona ni una solicitud.
2. **Abrí el contexto que ya está declarado.** Leé el `doc.md` y el `map.json` de cada nodo; el
   primero explica el comportamiento y el segundo limita qué fuentes son pertinentes. No recorras
   `ROUTE-MAP.md` completo cuando la tarea ya trae nodos.
3. **Cuando la entrada sea amplia, ambigua o `context_nodes` esté vacío, ruteá.** Primero alcanza el
   mapa local: `make context-jev ARGS='route "pregunta general"'`. Si está configurado `JEV_TOKEN`,
   la pregunta es segura y vale el costo de una segunda opinión, se puede sumar `--live`. Jev propone
   por dónde entrar; nunca autoriza una conclusión ni reemplaza abrir el nodo.
4. **Profundizá de a poco.** `brief <nodo>` prepara el panorama local. Después de leer el nodo, elegí
   como máximo tres archivos que su propio `map.json` declare y prepará `scope`; ese preview usa
   `main`/`origin/main`, no el working tree. Sólo si sigue faltando decidir *qué evidencia mirar
   después*, `review ... --live` puede pedirle a Jev una selección de evidencia. Jev no responde la
   pregunta de producto, no ejecuta código y no sustituye la revisión de las líneas fuente.
5. **Volvé a la evidencia.** Confirmá la hipótesis en el código y con la herramienta apropiada:
   `workers/` para hallar lo no documentado, `harness/` para comportamiento ejecutable y `trazador/`
   para datos de casos. Al abrir una tarea, dejá en `context_nodes:` sólo los nodos realmente usados;
   al cerrarla, graduá lo estable según «Qué deja esto en la tarea».

**Cuándo NO usar Jev.** Si la pregunta contiene cédula, teléfono, correo, número de solicitud,
credenciales, SQL o un log real; si requiere datos actuales de un caso; si su respuesta es
`manual-review`/`case-data`; o si su confianza no alcanza, se vuelve al ROUTE-MAP y a la investigación
manual. No se fuerza `JEV=1`: sin token, sin red o ante una abstención, el flujo local sigue siendo el
camino normal.

**Qué se puede enviar.** `route` sólo recibe una pregunta general y un catálogo compacto. `brief` es
local. Un `scope` es local, efímero y limitado a archivos declarados; sólo `review --live` recibe esa
evidencia acotada. No pegues un documento de tarea, código del working tree, secretos, datos personales
ni resultados de Trazador. El token queda en el entorno o `context/.env`, nunca en la UI ni en un
archivo de tarea. El contrato exacto y sus comandos están en [`docs/JEV.md`](docs/JEV.md).

## La vara es `main`. Lo que no está en main, se marca

Este árbol describe **lo que corre**, no lo que se está construyendo. Un nodo que documenta una rama sin
mergear es peor que un nodo faltante: se lee como verdad.

- **Verificá contra `main`**, no contra el working tree. Ante la duda: `git cat-file -e main:<relpath>`.

⚠⚠ **Y «`main`» es la rama LOCAL, que NO se actualiza sola — `git fetch` no la mueve.** `refs.py`
(`REF_HOY = "main"`), `oracle.py` y `alinear.py` leen esa rama, así que si está atrasada **todo el
árbol se valida contra el main de la semana pasada** y el verde no vale. Medido el 2026-09-16: los
tres repos estaban atrás —**legacy-backend 132 commits (8 días)**, legacy-application 75, y
frontend-monorepo 69—, y con eso `refs.py` reportaba **38 citas movidas cuando eran 69**: el ref viejo <!-- lint:ok -->
escondía **31 derivas reales**. Peor que el número: la MISMA cita daba dos correcciones distintas
—`:697` con el main viejo, `:709` con el real—, así que aplicar lo que dice la herramienta con el ref
atrasado **escribe mal**.

**Antes de creerle a cualquiera de las tres, poné los refs al día:**

    for r in legacy-backend legacy-application frontend-monorepo; do
      git -C ~/Desktop/CREDITOP/github/$r fetch origin --quiet
      git -C ~/Desktop/CREDITOP/github/$r rev-list --count main..origin/main   # 0 = al día
    done

Si alguno da distinto de 0, adelantalo con `git branch -f main origin/main` — ⚠ sólo si `main` **no
está en ningún worktree** (`git worktree list`) y **no tiene commits propios**
(`git rev-list --count origin/main..main` = 0). Los repos se trabajan en ramas, así que normalmente
se cumple; el `-f` sobre una rama con commits propios los pierde.

⚠ **Y esto no avisa.** El oráculo saca una línea por repo con la antigüedad del ref, pero es un aviso
suelto entre otros y se lee como ruido. Lo que lo destapó fue un «FUERA DE RANGO — la línea no existe»
que no cerraba: el archivo tenía 1064 líneas en `origin/main` y la herramienta decía 1018.
- El encabezado de cada nodo dice **contra qué se validó, cuándo y con qué método**. Si lo tocás,
  actualizá esa línea.
- Si hay que documentar algo que **todavía no está en main**, marcalo donde aparece:

  ```markdown
  > ⏳ **PENDIENTE DE MERGE** — esto vive en `feature/<rama>`, no en `main`.
  > Al mergear: re-verificar con el oráculo, actualizar y **borrar esta marca**.
  ```

  Inline y no en una lista aparte: se ve justo donde engaña, y todas se encuentran con
  `grep -rn "PENDIENTE DE MERGE" .`. **Después de cada merge, revisá esa lista** — y `alinear.py`
  también la chequea sola (señal 🔁).

- **Lo que es tarea no va acá.** Planes, decisiones pendientes, riesgos y preguntas abiertas viven en
  `tablero/data/<tarea>.md`. El test: *si esto se mergea mañana, ¿el texto sigue siendo cierto?* Si deja
  de tener sentido, es tarea. (Se coló dos veces en un mismo día: un plan completo y una sección de
  "restricciones del diseño pendiente".)

## Reglas de escritura de un nodo

Están codificadas en las plantillas (`server/data/doc-templates/`, leé el comentario de
`referencia.md`) y las vigila `tools/lint.py`. Las cinco que más costó aprender:

1. **El `when` se escribe ANTES que el doc.** Es la interfaz real: si no matchea el vocabulario con
   el que *llega* la tarea, el nodo no se abre nunca y nada de lo que escribas adentro existe.
2. **«Antes de concluir» va SEGUNDO, no al final.** Un modelo abre 2–4 nodos con una hipótesis ya
   formada, y lo primero que necesita es qué de esa hipótesis es falso. Se midió: ese bloque estaba
   llegando al **60–92 %** del documento en todos los nodos menos `creditop` —que lo pone al 8 % y es
   el que todos usan de ejemplo—, o sea después de toda la descripción, donde ya no cambia nada.
3. **Test del párrafo:** o cambia lo que un modelo haría en una tarea plausible, o previene un error
   que ya pasó (con su F-xx). Si ninguna de las dos, no va.
4. **Un hecho, una casa.** Si el hecho pertenece a otro nodo: `→ ver <nodo> § <sección>`, sin repetir.
   Lo que vive en el código (columnas, enums, códigos de error) no se copia: se apunta a la línea.
   Y marcá el estado de cada afirmación: lo **inferido** se declara inferido; leerse igual que lo
   verificado es como `servicing` llamó «stand-by» al estado 21 durante meses.
5. **Nada de estado-vivo contable** («hoy hay N…»): eso lo imprimen las tools. Un número-evidencia de
   una historia cerrada que sostiene una regla sí puede quedar. Y: **historia → git · preguntas →
   tablero · trampas con síntoma → findings.**
6. **Una herramienta de ESTE repo NO es un nodo.** `harness` y `trazador` lo fueron hasta el
   2026-09-21 y se retiraron: el árbol describe **CreditOp**, y cómo se usa una herramienta de acá
   vive en su `CLAUDE.md`, al lado de su código y commiteado con él. Tenerlo en los dos lados no era
   redundancia inofensiva — **ya había divergido**: la tabla de «quién decide el crédito por
   `response_type`» del nodo `harness` contradecía a la de `entities` en rt=0. Un hecho, una casa.
   Lo que se movió y adónde: el dominio al nodo que le corresponde (rt=0 corregido en `entities`
   contra `main`; el censo de las 14 tablas de log a `db-routines`) y lo operativo al `CLAUDE.md` de
   cada herramienta, tal cual, sin reescribirlo.
   ⚠ **Tres señales de que esto ya estaba mal antes de retirarlo, y valen como regla:** (a) de 24
   archivos con deriva en todo el árbol, **23 eran de herramientas locales** — el único de CreditOp
   quedaba enterrado; (b) los **tres** hallazgos que habían «graduado» a un nodo de herramienta
   estaban incompletos: F-108 a medias (su medición nunca llegó a `db-routines`) y F-32/F-36 nunca
   llegaron —su hecho ya vivía, por otro camino, en `smartpay` y `deceval`—. Un hecho del producto
   no tiene casa en un nodo de herramienta, así que quien gradúa pone el nodo donde trabajó, no
   donde el hecho pertenece. (c) Al medirlo, del nodo `harness` había **61 términos** y del de
   `trazador` **96** que no estaban en el `CLAUDE.md` de su herramienta: la copia del árbol se había
   vuelto la única fuente de cosas que no eran suyas.
   Y para que esto no vuelva solo: `roots.es_local()` decide qué alias es de acá **derivándolo de la
   ruta** (sin lista), y `alinear.py` no cuenta esos archivos como deriva ni siquiera cuando los cita
   un nodo de CreditOp, como hace `findings`.
7. **Antes de leer un diff, mirá si tocó lo que el nodo CITA** (`make context-diff NODE=x CITAS=1`).
   Un doc cita `archivo:línea` decenas de veces —63 en `kyc`, 93 en `onboarding`— y esos números son
   comparables con los rangos del diff: si el cambio reescribió alguna de esas líneas, la afirmación
   que está al lado puede ser falsa **hoy**; si cambió otra parte del archivo, es probable refactor.
   Tres cosas que el mapa distingue a propósito y costaron un diagnóstico equivocado cada una: los
   rangos se toman del lado **viejo** del hunk (una cita vive en las coordenadas del sello); una
   **inserción pura** no reescribe nada citado y corregir su desplazamiento es trabajo de `refs.py`,
   no una alarma; y una cita **escrita después del sello** no es comparable con este diff, así que se
   cuenta aparte en vez de mandarla al balde equivocado. ⚠ El mapa dice DÓNDE mirar, no qué pasó: lo
   que cambió *fuera* de lo citado es donde más seguido aparece lo que el nodo todavía no menciona.
8. **Un cambio que se miró y no toca lo que el nodo dice se TRIA, no se sella**
   (`make context-triar NODE=x VEREDICTO='…'`). `verified` afirma «una persona revisó este nodo
   entero»; moverlo por un cambio inocuo tiene un efecto que no se deshace: **el próximo diff arranca
   desde ahí**, así que si la clasificación estuvo mal ese cambio no queda pendiente, desaparece. Un
   sello equivocado no cuesta una lectura de más: cuesta la evidencia. `triado` dice lo mismo pero
   reversible —hasta qué commit se miró, quién lo dijo y con qué veredicto—, y `alinear.py` lo saca
   del conteo **sin** mostrarlo como al día: es 👁, un estado propio, porque un triaje que se viera
   igual que un sello sería un sello barato. La guarda es aritmética: si alguna cita cayó dentro del
   cambio, el comando se niega —eso se lee y se corrige—. ⚠ `source` dice quién lo dijo, por lo mismo
   que en el sello: hoy sólo se escribe `manual`; una máquina podrá escribir ahí cuando haya con qué
   medirla y con umbrales asimétricos, porque «no hay que mirar esto» y «mirá esto» no cuestan igual.
9. **Un hallazgo entra por la PUERTA o no entra.** `findings` declara la suya —«nadie lee este archivo
   entero: entrá por acá, saltá al `F-xx`»— y esa puerta es un índice escrito a mano, así que un
   hallazgo nuevo no está indexado hasta que alguien escribe su fila. Medido el 2026-09-21: **9 de 239
   hallazgos estaban fuera del índice de síntomas** (F-175…F-182 y F-184), justamente los últimos
   agregados, entre ellos el DNI que choca con una cédula y el 504 del gateway que igual escribe. Para
   quien entra por la puerta esos nueve no existían, y su ausencia se lee **«no nos pasó»** — el error
   caro de este repo, adentro de la herramienta que existe para evitarlo. Hoy lo cablea `L9` de
   `tools/lint.py`: cruza cada `## Índice` contra las anclas `### F-xx`, en los dos sentidos (un
   hallazgo sin fila, y una fila que apunta a un hallazgo inexistente). La fila la escribe una persona
   —el síntoma es con qué palabras LLEGA el problema, no el título del hallazgo—; lo que la máquina
   garantiza es que no falte.

## Confluence: hay oro, y hay specs disfrazadas de descripciones

`python3 tools/confluence.py espacios | paginas <ESP> | leer <id> | buscar <texto>` (solo lectura;
credenciales en `.env`, gitignoreado). Ahí vive lo que el código **no** puede decir: por qué una regla
existe, qué se le ofrece al comercio cuando pide una configuración, qué significa un booleano.

**Nada de ahí entra al árbol sin pasar por el código.** Toda afirmación se clasifica:

- **confirmada** — el código coincide. Entra, y lo que aporta es el **porqué**, no el qué. El mejor caso
  real: `debt_capacity_amount_validation` es un booleano cuyo nombre sugiere lo contrario de lo que hace,
  y el documento lo explica porque es **una pregunta que se le hace al comercio**.
- **contradicha** — difieren. Son las más valiosas y hay que decir **las dos cosas**: `loan_limit` es
  «el monto a colocar mensualmente» y está implementado como un acumulado que nada reinicia (F-119).
- **no verificable** — política pura, sin huella en el código. Se marca como tal o no se escribe.

⚠ **El espacio mezcla RUNBOOKS y PRDs, y se leen igual.** Las señas de un PRD: «objetivos», «fuera de
alcance», «historias de usuario», proyecciones de revenue — pero **la que decide es el grep**: hay un
«Modelo de Cobro de Gastos en Cartera en Mora» con modelo de datos completo de una feature que no
existe en ningún repo. ⚠ Y **un documento viejo es indistinguible de uno equivocado**: si el código y
el documento difieren y `git log` no dice cuál cambió, la contradicción se escribe como contradicción.

## El MCP está retirado — no lo reconstruyas

El server Go, el WebSocket, el conector stdio y el sistema de "derivar" se borraron a propósito
(`471d5a4` → `50f689e`). Hoy esto es un mapa **estático** + scripts Python.

- `server/` **no tiene código**: sobrevive como carpeta de datos (`server/data/flows/`). No muevas
  esos directorios — toda ruta citada en los docs apunta ahí.
- `src/App.vue` (la viz) es **read-only**: lee `tree.json`, `flows/*` y `alineacion.json` por
  `import.meta.glob`. No le agregues persistencia, WS ni botones de guardar. Su **buscador** y el grafo
  de vecindad —derivado de los archivos que dos nodos comparten, descartando los hubs— salen del mismo
  glob y no guardan nada; el detalle y lo medido, en `README.md`. La única excepción es el middleware
  efímero de desarrollo para la consola JEV: llama `tools/jev.py`, no guarda scopes ni expone tokens
  al navegador. **Si necesitás mostrar algo que la viz no puede calcular** (git, la BD): que un
  **comando** lo calcule y deje un JSON que la viz lee por el mismo glob — así se hizo la alineación.

## El oráculo y el ROUTE-MAP corren SOLOS (hooks)

Al escribir cualquier `map.json` del árbol, un hook valida las rutas y regenera el `ROUTE-MAP.md`; al
escribir `tree.json`, regenera el mapa (registrar un nodo sin regenerar lo dejaba invisible — así quedó
`microservicios` afuera sin que nada avisara). `.claude/hooks/oraculo.py` · registrado en
`.claude/settings.json`. Y `ROUTE-MAP.md` / `tools/index.txt` / `alineacion.json` **no se editan a
mano**: otro hook lo bloquea, porque son generados.

**El oráculo valida contra `main`** (vía `git ls-tree`, read-only, sin fetch ni checkout), no contra lo
que tengas checkeado. Eso tapa el error grave, que no es el falso DROP sino el **falso OK**: con otra
rama puesta, una ruta que solo existe ahí resolvía perfecto mientras el nodo afirmaba describir `main` —
así entró la deriva de `motai`.

```bash
python3 tools/oracle.py <map.json>              # contra main (default)
python3 tools/oracle.py <map.json> --ref qa     # contra otro ref
python3 tools/oracle.py <map.json> --worktree   # contra el índice: lo que está checkeado
```

Exit: `0` limpio · `1` hay DROPs · `2` algún repo no se pudo consultar (sale como **`SIN VERIFICAR`** y
**no cuenta como OK** — callarlo sería inventar un verde).

Cuando dropea una ruta, tu criterio:

- **`.md`, `.sql` y `.yaml` SIEMPRE dropean**: solo se indexan extensiones de código (`tools/roots.py`).
  No van en `files[]` — mencionalos en el `doc.md`.
- **Si el archivo existe pero en otra rama**, es contexto sin mergear: sacalo de `files[]` y marcá la
  sección con `⏳ PENDIENTE DE MERGE`.

⚠ `ROOTS`/`EXTS` viven en **`tools/roots.py`**, importado por los demás scripts. Estuvo duplicado y se
desincronizó: un repo agregado en un solo lado da un veredicto equivocado sin fallar en ningún lado.

## El sello `verified`: para saber si un nodo quedó VIEJO

El oráculo contesta *¿el archivo existe?*. La otra pregunta —*¿sigue diciendo lo mismo que cuando
escribí el nodo?*— necesita una fecha legible por máquina, y por eso cada `map.json` lleva:

```json
"verified": { "ref": "main", "date": "2026-07-31", "source": "cabecera" }
```

`source` dice **cómo** se obtuvo la fecha, y evita tratar una estimación como un hecho: `cabecera`
(alguien la escribió al verificar) · `git-doc` (**estimada**: último commit del `doc.md`; es un piso) ·
`manual` (la puso el comando al sellar). Con eso la deriva se calcula con git y ve lo que el oráculo no
puede: un nodo con todas las rutas resolviendo puede describir código que cambió por debajo.

**Al re-verificar un nodo, sellalo:** `python3 tools/sellar-verificado.py <nodo>`. Si no, el nodo queda
contando una deriva que ya arreglaste.

### Cómo se re-verifica un nodo (el método, antes de sellar)

El árbol afirma; re-verificar es intentar **refutarlo** contra el código. Una afirmación no auditada no
es una afirmación confirmada. El método, destilado de las veces que falló:

1. **Extraé del doc las afirmaciones verificables** — las que, si fueran falsas, cambiarían lo que un
   modelo hace. La prosa conectiva no se audita.
2. **Clasificá antes de verificar:** **CÓDIGO** (se decide leyendo `main` — se verifica acá) · **DATO**
   (habla de la BD o de prod: conteos, umbrales — **no lo leas: medilo**, `make trazador-sql` /
   `make agente-datos`) · **HISTORIA** (algo que pasó, con fecha — no se re-verifica; sólo marcá si el
   texto lo presenta como estado actual siendo viejo).
3. **Verificá el SIGNIFICADO, no el ancla.** ⚠ La lección que originó este método: una cita
   `archivo:línea` puede apuntar a una línea que existe, con el texto esperado — y ser de OTRA función
   que no hace lo que el doc dice (pasó con un «sello rt=2» que era un stamp post-listado). Leé la
   función alrededor. Un número corrido ≤3 líneas no es un hallazgo; la función equivocada, sí.
4. **Contra `main`, con git** (`git -C <repo> show main:<relpath>`), nunca el working tree — los repos
   viven en ramas. Las secciones `⏳ PENDIENTE DE MERGE` se verifican contra la rama que la marca
   nombra; si sus archivos ya están en `main`, eso es «marca ya mergeada» y vale oro.
5. **Al contar confirmadas, separá chequeo fuerte** (leíste la función y hace lo que el doc dice) **de
   débil** (sólo viste que el símbolo existe). Un ok débil declarado fuerte es la mentira que este
   árbol ya sufrió una vez. De ese conteo depende si el nodo se sella.

## `flota.py`: la auditoría que NO espera la deriva

**Los tres instrumentos de arriba tienen el mismo techo: los tres esperan que algo se mueva.** Está
medido, el 2026-09-08, auditando el corpus hermano (canon): de **178 hallazgos**, sus 480 citas de <!-- lint:ok -->
evidencia caen en un archivo que la deriva había marcado sólo **44 veces — el 9 %**. O sea que **el
91 % de lo que estaba mal vivía en archivos que nunca se movieron**: prosa falsa desde el día en que se
escribió, o envejecida por un cambio en OTRO archivo. Ni el oráculo, ni `alinear.py`, ni `diff.py`
iban a llegar ahí.

La auditoría que sirve es leer una afirmación y preguntarle al código si es cierta HOY. Eso **cuesta
un agente por paquete**, así que no es rutina: se corre cada tanto, o después de una tanda grande de
merges. Lo que es gratis es el reparto:

```bash
python3 tools/flota.py               # el resumen: cuántos paquetes y qué lleva cada uno
python3 tools/flota.py json          # los paquetes, para lanzarlos
python3 tools/flota.py --comprobar   # verifica sus tres garantías
```

Cada paquete trae lo que un agente necesita y nada más: las secciones (con su ancla y su tamaño), los
archivos que el nodo declara —con su repo resuelto, si derivaron y si la ruta está muerta—, y **los
síntomas por los que se entra al nodo**, para que juzgue si la prosa contesta lo que se le pregunta y
no sólo si es cierta.

**Qué se le pregunta a cada agente.** Una sola cosa, y no «mejorá esto»: *por cada sección de tu
paquete, ¿lo que afirma es cierto contra `origin/main`?* La salida es una lista, y cada hallazgo lleva
cinco campos: el **tipo** (`contradice` · `impreciso` · `falta` · `caduco` · `grafo`), la **afirmación**
tal como está escrita, **qué dice el código**, la **evidencia** (repo, ruta, líneas y la cita literal) y
la **corrección** propuesta. Sin cita citable no es un hallazgo: es una opinión. Y **devolver la lista
vacía es una respuesta válida y esperada** — inventar para entregar algo es el peor resultado.

**Y después, dos filtros que no se saltan.** Primero un pase **adversarial**: otro agente que intenta
REFUTAR cada hallazgo, con veredicto `confirmado` · `refutado` · `dudoso`. Medido sobre 78 hallazgos: <!-- lint:ok -->
**64 confirmados, 10 dudosos, 4 refutados** — y en los 10 dudosos el núcleo era real pero la corrección
propuesta, pegada tal cual, metía un error nuevo. Después, **verificar a mano contra `origin/main`
antes de escribir**, sección por sección.

⚠ **Las dos formas en que ya falló, las dos evitables:**

1. **Clones viejos.** De los hallazgos de aquella auditoría (2026-09-08), los **2** que se cayeron fue
   por leer un clon sin `git fetch` <!-- lint:ok -->
   y en uno **la prosa que ya estaba era la correcta**, así que aplicarlo la habría roto. Los dos
   eran de repos que no son los dos monolitos, que son los que menos se sincronizan.
2. **Pegar la corrección propuesta tal cual.** Viene redactada, y a veces está mejor escrita que
   precisa: una llamaba con el mismo nombre a dos campos distintos —uno se cifra y el otro no—, y
   pegarla dejaba una sección que nadie puede leer sin equivocarse. La corrección es materia prima.

## `canon-solape.py`: dónde el árbol y canon se contradicen, y qué escribió el equipo

**El caso que lo pagó.** La auditoría de canon del 2026-09-08 gastó 28 agentes y su hallazgo más caro
fue que su sección del cupo rotativo describía **un solo motor** cuando hay dos, con cortes distintos.
**El árbol ya lo tenía**: `flows/rotativo/doc.md` trae la tabla comparativa —el redondeo, el nivel
truncado contra redondeado hacia arriba, el plazo mínimo sobre el cupo contra sobre el tope—. El
conocimiento existía, no graduó, y canon cargó una falsedad meses hasta que una auditoría cara la
redescubrió. Eso es lo que este comando ataca, y va en las dos direcciones:

```bash
python3 tools/canon-solape.py --arbol    # secciones del árbol que pisan una de canon
python3 tools/canon-solape.py --canon    # lo que canon dice y el árbol NO menciona (la mitad que sirve
                                         # para mantenerlo al día sin leer todo)
```

⚠ **Genera candidatos, no veredictos.** La comparación es léxica: puntaje alto = palabras compartidas,
no la misma afirmación. Medido el 2026-09-09: de los pares fuertes, **cerca de la mitad** hablaban de
verdad de lo mismo — el resto era coincidencia de vocabulario. Hay que leer el par.

⚠ **Y solape no es duplicación.** Muchas veces el árbol dice lo mismo con algo que canon **no puede**
decir —ids reales, `archivo:línea`, la receta para correrlo—: ahí las dos versiones se quedan. Lo que
hay que arreglar es cuando **se contradicen**, y ahí la pregunta es cuál de las dos se verificó después.

⚠ **El cubrimiento se mide contra el MEJOR NODO, no contra el árbol entero.** El primer intento
preguntaba «¿aparecen estas palabras en algún lado?», y contra un árbol de este tamaño la respuesta es
casi siempre sí: dio dos huérfanas de trescientas, o sea ninguna señal.

## `refs.py`: ¿las citas `archivo:línea` siguen apuntando a lo que dicen?

```bash
python3 tools/refs.py            # todos los nodos
python3 tools/refs.py <nodo>     # uno solo
```

Las citas `archivo:línea` son lo que se rompe **en silencio**: un refactor mueve una función 30 líneas
y la cita queda señalando otra cosa. El oráculo no lo ve (el archivo existe) y `alinear.py` tampoco
(solo dice que cambió).

**Cómo lo sabe: el ancla de git, no el símbolo de la prosa.** Para cada cita busca *cuándo se afirmó*
(max entre el sello del nodo y el `git blame` de esa línea del doc), abre el archivo citado en `main`
**a esa fecha**, guarda el texto de la línea y lo busca en `main` hoy. Si está en otra línea, **dice
cuál**. No marca: corrige. Sigue renombres.

⚠ La lección que dejó construirlo: una versión anterior buscaba el símbolo con una regex que nunca
matcheaba, y **todos sus «ok» eran del chequeo débil** («el archivo tiene al menos N líneas») — una cita
corrida seis líneas pasó en verde y con ella se selló un nodo. Si volvés a tocar esto: **medí cuántos
«ok» son del chequeo fuerte**, no cuántos son «ok». Los baldes débiles se declaran (`sin ancla`).

⚠ **Su corrección se aplica SÓLO si es unívoca, y hay DOS marcadores de ambigüedad, no uno.** El
obvio es `· N candidatos`. El que se pasa por alto es **`(y N coincidencia(s) más)`** pegado al final
de la línea: significa que el texto del ancla aparece en varios lugares del archivo y el tool eligió
el más cercano. Medido el 2026-09-16 sobre las 69 movidas del árbol: clasificando sólo por
`candidatos` daban **30 seguras**, y nueve de ésas traían ese sufijo — o sea que **el 30 % de lo que
parecía seguro no lo era**. Las verdaderamente aplicables sin leer el código son las que no traen
ninguno de los dos, ni `revisalo a mano`, ni `confirmalo`.

⚠ **La salida de las citas CORTAS es convertirlas a ruta completa, y se hace LEYENDO.** El propio
docstring de `refs.py` documenta por qué no se resuelven solas (se intentó, dio 22 fallos falsos: los
docs nombran al sujeto por CLASE, no por archivo). Convertidas en seis nodos el 2026-09-16 —de 924 a
572, cobertura del 54 % al 71 %— y **cada nodo destapó entre dos y quince citas que apuntaban al lugar
equivocado**, invisibles hasta entonces. Tres formas en que «el archivo más cercano» escribe mal, las
tres vistas: la cita va **antes** del archivo en su línea (`profiling` L43) · la línea nombra **varios**
y se reparten (`merchants` L115/L116) · el archivo se nombra **sin número** y el patrón no lo ve
(`profiling` L135). Y una cuarta: a veces la cita corta es **meta** —el texto habla de una cita que ya
no existe— y expandirla inventa una referencia (`merchants` L217). Y una quinta, la peor porque el
resultado parece válido: **`` `:5174` `` puede ser un PUERTO y no una línea** (el wizard, el mock, un MinIO).
En `findings` eran tres de 42; expandirlas habría inventado tres referencias a líneas inexistentes. Si la
prosa dice «vive en» o «corre en», mirá antes de expandir — y reescribilas como «el puerto `5174`» para que
dejen de contarse como citas cortas. **Y `legacy-application/` NO es un alias: es `application/`** (`tools/roots.py`);
seis citas del árbol lo usaban y salían como «no existe en main».

⚠ **Un desplazamiento uniforme tampoco sirve.** En `bancolombia`, `BancolombiaBnpl.php` se corrió **+21
hasta `retrieveQuota` y +29 de ahí en adelante**; en `profiling`, `LenderUserCategoryService.php` creció
+20, +47, +83, +326 y +329 en cinco puntos distintos. Se verifica **método por método**
(`grep -n "public function …"` contra `main`), no con una resta.

Baldes: `ok` · `corrida` (≤3 líneas, no falla) · **`movida`** (apunta a otra parte, con la corrección) ·
`reescrita` · `fuera` · `sin ancla` · `ambigua` · `no existe`. ⚠ `ambigua`/`no existe` **no siempre son
deriva**: herramientas borradas, artefactos generados, repos fuera de los roots y **migraciones citadas
por nombre parcial** — Laravel las prefija con timestamp, así que citálas con el nombre completo.

## `simbolos.py`: `refs.py` mide DERIVA, no verdad — y editar una cita la congela en verde

```bash
make context-simbolos              # todos los nodos  (o: python3 tools/simbolos.py <nodo>)
```

⚠⚠ **`refs.py` nunca comprobó que una cita fuera CIERTA.** Guarda el texto que tenía la línea citada
**el día que se afirmó** y avisa si hoy está en otro lado. Para lo que hace está bien — pero una cita
que nació apuntando al método equivocado es **✓ para siempre**, porque el ancla es «lo que había
ahí», no «lo que la prosa dice que hay ahí».

⚠⚠ **Y hay algo peor, que se midió el 2026-09-16: EDITAR una cita la re-ancla contra HOY.** La fecha
sale de `git blame` sobre el propio doc, y las líneas sin commitear salen con fecha de hoy — el
docstring de `refs.py` lo dice y es deliberado (sin eso, corregir una cita la volvería a romper). La
consecuencia no se había visto: **la pasada de citas cortas a ruta completa toca todas las líneas, así
que CONGELA EN VERDE lo que estuviera mal**. El nodo sale con ✓ más alto y menos deriva justo cuando
perdió la única vara que podía delatarlo.

**La otra mitad la mira `simbolos.py`:** si la prosa escribe
`` `…OnboardingController.php:899` `validateOtpCodeAndRedirect` ``, ¿está ese símbolo cerca de `:899`
en `origin/main`? Estaba en `:937`. Corrido sobre el árbol el 2026-09-16 destapó **67 citas <!-- lint:ok -->
equivocadas en nueve nodos** —el orquestador del OTP entero, las relaciones de `User` en los dos
monolitos, `retrieve_terms` que ya no existe— y ninguna la veía `refs.py`.

Las **dos** trampas que lo hacen más angosto de lo que uno escribiría, las dos medidas:

1. **El símbolo tiene que estar PEGADO** — entre la cita y el backtick sólo un espacio y/o un
   paréntesis que abre. Con tres caracteres de tolerancia entraba `). ` y se leía el símbolo de la
   frase **siguiente**: tres falsos positivos. Es lo mismo que advierte el docstring de `refs.py`
   cuando dice que emparejar con el símbolo contiguo «tampoco se puede»: se puede sólo siendo así de
   estricto, y aun así **reporta, no corrige**.
2. **El mismo archivo vive en DOS repos.** `app/Models/User.php` y `app/Actions/RiskCentrals/Experian.php`
   están en `legacy-backend` y en `legacy-application`. Probar uno solo inventa deriva:
   `Experian.php:51` es **correcta** en `application` y absurda en `legacy-backend`. Se prueban todos
   los candidatos y sólo se marca si falla en todos. Para saber cuál quiere el nodo: **su `map.json`**
   (`actors` declara `application/app/Models/User.php`), no el orden de los repos.

⚠ **Cubre el 9 % (124 de 1.317).** Las demás no traen símbolo pegado y esta vara no las alcanza; ahí
la única sigue siendo `refs.py`. Se dice el número por la misma razón por la que `refs.py` declara las
cortas: **un verde que cubre una décima parte y no lo dice es la trampa que las dos vienen a no
repetir.**

⚠ **Y al expandir citas cortas, el orden importa:** `simbolos.py` **antes** de commitear la expansión,
no después. Después ya no hay nada que delatar.

⚠ **Lo que marca y ESTÁ BIEN se anota, no se re-verifica cada vez.** `tools/simbolos-revisadas.txt`
guarda las citas ya comprobadas a mano con el motivo por el que la heurística las marca (el símbolo es
de la frase de al lado · el nombre es una TABLA y no un identificador del archivo · lo usa un helper
fuera de la ventana). **La lista no se puede pudrir en silencio**, y ése es todo el diseño: la clave
lleva la **línea exacta**, así que en cuanto alguien corrige esa cita la entrada deja de coincidir, la
herramienta avisa que sobra y **sale con error**. Una lista que perdonara «el nodo X entero» sí se
pudriría. Anotá sólo lo que verificaste vos contra `origin/main`, con el motivo escrito.

## `alinear.py`: qué nodos quedaron viejos (corrélo DESPUÉS DE CADA MERGE)

```bash
python3 tools/alinear.py          # calcula, imprime y escribe alineacion.json
python3 tools/alinear.py --ver    # solo imprime
```

Tres señales: **⛔ rutas muertas** (el mapa miente) · **🔴🟡 deriva** (archivos tocados en `main`
después del sello) · **🔁 marca ya mergeada** (un `pending_merge` cuyos archivos ya están en `main`:
devolvé las rutas a `files[]`, re-verificá y borrá la marca).

⚠ **La deriva NO ve el hueco más grande: lo que el árbol nunca supo.** `alinear.py` compara los
archivos que el nodo YA declara — si mergea una funcionalidad entera que ningún `map.json` cita, no
aparece en ninguna señal. El silencio del árbol se lee igual que «no existe», y eso es lo que hace
que un modelo conteste con confianza sobre un sistema que ya cambió.

Para eso están los dos movimientos complementarios, probados el 2026-08-16:

- **`tools/diff.py <nodo>`** — qué cambió en el CÓDIGO de un nodo desde su sello. Encuentra cosas que
  la deriva no prioriza: `can_check_preapproval` salió del diff de un nodo con deriva **baja** (3
  archivos), y era una funcionalidad entera de 19 líneas.
- **`workers/`** — el índice se deriva de `main`, así que cubre lo que nadie escribió.
  `workers/cli.py buscar "…"`, o `make agente-analisis PREGUNTA='…'` si hay mucho que leer. Un archivo
  que se repite en la deriva de varios nodos es la pista clásica: así apareció el endpoint de
  regeneración de Credifamilia, citado por muchos y descrito por ninguno.

Después de encontrarlo: verificá contra `main`, escribí la sección, sumá las rutas al `map.json`, y
**no sellés** — el sello dice «revisé el nodo entero», no «agregué una parte».

⚠ **«Cambió» se mide con el diff NETO (`git diff <sello>..main`), no con `git log`** — log falló dos
veces en silencio (no imprime archivos en merges con `--name-only`, y con first-parent reporta
movimiento de ida y vuelta como deriva). El diff neto contesta la pregunta exacta: *¿este archivo es
distinto de cuando lo verifiqué?*

Cada nodo con deriva trae **cuántos commits entraron, qué dijeron y quién los firmó** — para decidir si
vale abrirlo y a quién preguntar. ⚠ El asunto dice la **intención**, no lo que pasó. Lo que decide es
el código:

```bash
make context-diff NODE=onboarding STAT=1   # cuánto cambió cada archivo
make context-diff NODE=onboarding          # el diff acumulado sello..main, para leer
```

⚠ **La deriva es una señal de PRIORIDAD, no un veredicto.** La primera revisión con esto encontró que
un 36% de archivos tocados se tradujo en UNA corrección: los hallazgos citan **comportamientos**, no
líneas. Un nodo que cita mecanismos aguanta mucho cambio; uno que cita `archivo:línea` se rompe con
cualquier refactor. Ordená por deriva, pero no concluyas que N archivos tocados son N errores.

**`pending_merge` va en el `map.json`, no solo en prosa** (el chequeo inverso necesita las rutas
estructuradas):

```json
"pending_merge": { "ref": "qa", "files": ["legacy-backend/…/AbacoStepResolver.php", "…"] }
```

⚠ `alineacion.json` es GENERADO y **se versiona a propósito**: su historia en git dice **cuánto
tiempo** lleva viejo un nodo, no solo que hoy lo está.

## Qué deja esto en la tarea (y qué se lleva de vuelta)

Con [`tablero/`](../tablero/CLAUDE.md) el intercambio va en los dos sentidos, y por eso es el único que
no se resuelve con una sola línea:

| cuándo | qué pasa |
|---|---|
| al ABRIR la tarea | los nodos que hay que leer antes de investigar van a **`context_nodes:`** del frontmatter — no en la prosa |
| mientras se trabaja | el nodo es la FUENTE: se cita, no se copia. Lo que ya está acá no se repite en la tarea |
| al CERRAR | lo que resultó ser **del sistema** (no de la tarea) **GRADÚA** a un nodo, o a `F-xx` si es una trampa con causa raíz |

⚠ **El enlace es UNIDIRECCIONAL, y romperlo se paga al graduar.** La tarea apunta a nodos; el nodo
**nunca** apunta a tareas. Si un nodo cita la tarea que lo originó, el día que esa tarea se archiva el
nodo queda mintiendo — y los nodos no se releen solos.

⚠ **Y `context_nodes` está vacío en 28 de 68 tareas** (medido el 2026-09-18), mientras que **43 de 68
nombran `context` en la prosa**. O sea: la información existe y está donde no se puede recuperar — el
frontmatter es lo que el tablero lee; un párrafo no.

**El test para saber si algo gradúa** es el mismo de siempre: *si esto se mergea mañana, ¿sigue siendo
cierto?* Sí y es del sistema → acá. Sí y es de la tarea → se queda en su `.md`. No → es un hecho de
ese día y va al Registro de la tarea.

⚠ **A Jira no va nada de acá.** Un nodo es privado por definición: nombra repos, rutas y `F-xx`, que
son exactamente los tres patrones que el guard del tablero frena. Lo que se comparte es el HECHO
traducido a lenguaje de producto — la regla, con qué poner en su lugar, está en
[`tablero/CLAUDE.md`](../tablero/CLAUDE.md), en «La frontera del guard está DENTRO del archivo».

## Al CERRAR una tarea: ¿el árbol te llevó hasta la causa?

Es la única pregunta que hace que este árbol mejore solo, y son 10 minutos. Hacela **siempre**, aunque
la tarea haya salido bien — sobre todo si salió bien por `grep`.

**Si el árbol NO te ruteó** (fuiste directo al código, o abriste el nodo equivocado), tres arreglos:

1. **El archivo causa-raíz al `map.json` del nodo correcto, CON SU PORQUÉ en el `doc.md`.** Listarlo
   sin explicarlo no sirve — para eso `grep` es más rápido (`make context-salud` mide los mudos).
2. **La REGLA GENERAL a «Antes de concluir», no el caso.** «El export tiene un bug» se arregla y
   desaparece; «un filtro por rol con `when()` encadenados falla ABIERTO» sigue valiendo. Si la regla
   contradice una conclusión que parecía obvia, va también a los **invariantes** del nodo `creditop`.
3. **La frase con la que LLEGÓ el problema, a `sintomas[]` del `map.json`.** Es lo que arma la tabla
   «Entrá por el síntoma» del ROUTE-MAP.

**Y si el árbol SÍ te ruteó**, mirá si algo quedó desactualizado por lo que aprendiste: una cita
corrida, un `when` al que le faltó la seña que vos buscaste, un nodo para re-sellar.

Medí antes de decidir: `make context-salud` dice qué `when` no tiene señas, qué archivos están listados
y mudos, qué archivos-hub viven en demasiados nodos y qué `F-xx` quedó fuera del índice.

## Nodo nuevo: dos lugares, los dos a mano

1. `server/data/flows/<id>/map.json` (`name`, `kind`, `when`, `sintomas[]`, `files[]`) + `doc.md`
   desde las plantillas de `server/data/doc-templates/`.
2. **Registralo en `tree.json`** (`parent`). El hook regenera el mapa solo.

- El `kind` va en inglés (`root` · `reference` · `flujo` es la excepción ya acuñada) y vive en el
  `map.json`. Los campos `combination`/`group` (map.json) y `targets`/`baseline` (tree.json) están
  muertos: no los copies.
- El `when` va en el vocabulario con el que **llega** la tarea, no en el del código: sin embeddings,
  esa línea es lo único que rutea al modelo.

## Findings

Entrada nueva = `### F-NN` correlativo, con los 5 campos síntoma → causa raíz → evidencia → arreglo →
estado, **y su fila en el índice `## Índice · ¿con qué síntoma llegás?`** — eso es lo que la vuelve
encontrable: nadie lee el archivo entero. La causa raíz va **verificada** o marcada `hipótesis, sin
confirmar`; si el síntoma engaña, decilo en el título. El protocolo completo (techo de líneas, stubs,
cuándo gradúa una crónica a `cerrados.md`) vive en la cabecera del propio archivo.

**El `F-xx` es un identificador público** citado desde código de tres herramientas (`harness/`,
`trazador/`, `tablero/`): no se renumera, no se muda de archivo, y `findings/doc.md` no se parte —
**el ancla `### F-xx` tiene que seguir resolviendo siempre**. Al graduar el hecho a un nodo, el
cuerpo se colapsa a stub ese mismo día; la crónica queda en git y en `cerrados.md`.
