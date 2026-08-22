# demo · buscá en el código de este repo, y llevate el vecindario

Prototipo. **NO es fuente de contexto** (ver el `CLAUDE.md` de la raíz), y a propósito **no está en el
`make`**: cuando esté listo cambia de nombre y ahí entra.

```bash
cd <cualquier repo> && demo can_check_preapproval
```

Eso es todo. No hay que configurar nada, no hay índice que construir, no hay alias que registrar: el
repo se **descubre** del directorio actual con git.

## Para qué existe

Un modelo parado en un repo necesita contestar «¿qué archivos toco para esto?» en la **primera
iteración**. `grep` le da los archivos que contienen el término y nada más. Lo que le falta es lo de al
lado: de quién dependen esos archivos, quién los llama, y qué saben hacer.

Eso es lo que agrega. Buscando `can_check_preapproval` devuelve los 5 archivos que lo contienen **más 7
que no** — entre ellos `ProfilingRulesService` (que no tiene el término en ninguna línea) y
`LenderRetrievalService`, la clase padre donde vive el pipeline. Un grep no puede verlos por
construcción.

## Cómo funciona, y por qué no hay paso de índice

**El grep no es sólo la semilla: es el resolvedor.** Una semilla dice `private LenderRepo $repo`; para
saber qué archivo es `LenderRepo` no hace falta composer ni PSR-4 — se le pregunta al repo con
`git grep "class LenderRepo"`, y todos los nombres que hagan falta van en UNA invocación con varios
`-e` (de a uno costaba ~80 ms cada uno).

Resultado medido en `legacy-backend` (2.529 archivos .php):

| | archivos parseados | tiempo |
|---|---|---|
| `demo show <archivo>` | 1 | **54 ms** |
| `demo hierarchy <clase>` | 3 | **243 ms** |
| `demo neighbors <archivo>` | 29 | ~1 s |
| `demo <término>` | ~51 | ~2 s |
| `demo files` / `measure` / `edges` / `cases` (repo entero) | 2.529 | ~500 ms |

Y no hay archivo de índice, así que **no hay nada que pueda envejecer sin avisar** — el problema que
tenía la versión anterior de esto.

⚠ **Por defecto lee el WORKING TREE**, no `main`. Es un cambio deliberado: para un modelo que está
editando este checkout, lo que hay en disco es lo correcto. `--rev main` lee esa rama, y **la salida
siempre dice cuál de las dos usó** — la ambigüedad era el problema, no la elección. El primer test lo
mostró solo: en la rama `fix/CORE-258` el término no existe, y decir «no matcheó nada en working tree»
es la respuesta correcta.

## Los comandos

| | |
|---|---|
| **`demo <término>`** (= `find`) | ⭐ grep + los vecinos a un salto. El 90% del uso |
| `methods <nombre>` | métodos por nombre. **Lo único que una lista de rutas no puede dar** |
| `cases [texto]` | las reglas de negocio en prosa, de las descripciones de los tests |
| `show <archivo>` | el detalle de uno · o el esqueleto de lo que pase el filtro |
| `files` | listar y filtrar |
| `neighbors <archivo>` | quién lo llama y a quién llama, con la procedencia de cada arista |
| `hierarchy <clase>` | la cadena de herencia, hacia arriba y hacia abajo |
| `edges` | las conexiones del repo, filtrables por cómo se resolvieron |
| `measure` | compresión y qué tanto del cableado se pudo resolver |

### Los filtros se comparten y se combinan

Un solo predicado ([filters.go](filters.go)) lo usan casi todos los comandos, así que `--tier test`
significa lo mismo en todos lados. Si cada comando armara el suyo, una discrepancia no fallaría:
devolvería otra cosa.

    --prefix Modules/Risk   --tier code|test|migration   --class X   --extends X
    --trait X   --implements X   --uses X   --method X   --table X   --case "texto"
    --with-cases   --orphan   --leaf   --min-methods N   --max-methods N
    --sort path|tokens|methods|in|out   --limit N

Más `-C <dir>`, `--rev <ref>`, `--ext .php` y `--json` en todos.

```bash
demo can_check_preapproval --new-only     # SÓLO lo que el grep no encontró: el aporte del grafo
demo cases cupo                           # las reglas escritas sobre cupo
demo methods recalcul                     # ¿cómo se llama el método que recalcula?
demo edges --kind ctor                    # auditar: lo único resuelto por INFERENCIA
demo edges --inherited --to LenderRetrieval   # auditar: lo hallado subiendo por extends
demo files --prefix Modules/Risk --sort in --limit 10
```

⚠ `--orphan` quiere decir «nadie lo llama **según lo que se cargó**», no «código muerto». En los
comandos a demanda el grafo es parcial por diseño; en los que cargan el repo entero, el 77,8% de los
call sites sin resolver tampoco alcanza para afirmar lo segundo. `measure` lo imprime cada vez.

## La tesis, y el número que la sostiene

El lector recibe archivos **enteros** y su techo real son 35-40 antes de que recorte. Medido sobre
`legacy-backend:main`, 2.529 archivos PHP parseados en **458 ms**:

| | tokens | |
|---|---|---|
| los 2.529 archivos completos | ~2.874.000 | |
| esqueleto pleno (firma de cada método) | ~337.700 | 8,5x |
| **escalonado** (ver abajo) | **~265.900** | **10,8x** |

En la ventana de 300k del lector caben ~264 archivos enteros. Escalonado cabe **el repo entero**.
Y en un archivo concreto: `LenderListingService.php` pasa de ~6.440 tokens a **537** (12x) sin perder
un nombre de método — incluido `stampCreditopXApproval:405`, el que el experimento del triaje tuvo que
rescatar a mano.

⚠ Pero el repo entero **nunca fue la unidad correcta**. Por módulo el problema se disuelve:
`Modules/Risk` son 45 archivos y **8.390 tokens**; `Modules/Onboarding`, ~38.700. `./demo map`
acepta un prefijo justamente para eso.

## Escalonar, no filtrar

La pregunta natural es «¿y si saco los tests y los mocks?». Medido: quitar tests, migraciones, seeders
y config saca el **32% de los archivos y sólo el 21% de los tokens**, porque **el esqueleto ya es un
filtro, y filtra mejor que un filtro** — `config/` son arrays sin firmas y se comprime **252x** sin que
nadie lo excluya. (Y los mocks son 4 archivos y 540 tokens: en este repo no existen. El de verdad es
`risk-services-mockery-lambda`, otro repo, sin indexar.)

Borrar además tiene un costo que no se ve: si los tests no están en el mapa, el seleccionador **no
puede rutear a ellos** — y son uno de los ángulos que `workers` lista como productivos.

Así que cada archivo recibe la representación que sí informa:

| tier | qué manda | |
|---|---|---|
| `code` | la firma completa de cada método + qué inyecta | el default |
| `test` | los nombres de método **y las descripciones de Pest** | 1,5x más barato que su esqueleto |
| `migration` | el archivo + **las tablas que toca** | las firmas `up()`/`down()` son ~19.000 tokens de cero información |

Escalonado da **265.865** tokens: menos que borrar tests y migraciones (262.722 era el número de
borrarlos) al mismo orden, y con todo el repo todavía ruteable.

⚠ El render de `codigo` **no emite los `use`**: las aristas resueltas ya llevan esa información, con
procedencia. Es deliberado, no un olvido.

### El hallazgo que no esperábamos: 779 reglas de negocio en prosa

Los tests de este repo son mitad PHPUnit (clases con métodos) y mitad **Pest** (`it('…', fn)`, sin
clase y sin métodos). Un tier que sólo mirara métodos los perdía enteros. Capturando la descripción
salen **779 casos en 72 archivos**, y son prosa de negocio:

    · no pisa un true ya asignado por RiskCentralValidationService
    · serializa el campo como booleano JSON, no como 1/0
    · pone can_check_preapproval en false a una entidad que nunca pasó por la validación

La primera es exactamente la distinción **clasifica vs. excluye** que el grafo de cableado no puede
expresar. O sea: el tier más barato del mapa resultó ser el que más semántica trae. Ni `workers` ni
`context/` tienen hoy este índice.

## Lo que este mapa NO contesta

**El cableado no es el negocio.** El grafo dice que `getLenders()` llama a `applyProfilingRules()`; no
dice que perfilamiento sólo **clasifica** mientras el status de la sucursal **excluye** — esa
diferencia es un `continue` contra una asignación dentro de un loop. El significado vive en `context/`
y este mapa apunta ahí.

**Es un enrutador, no un contestador.** Su lugar es alimentar a `seleccion.py`, no reemplazar a
`lector.py`.

## La regla de diseño: las aristas las resuelve el código

Medido en los dos monolitos, el **65%** de las definiciones de método cae bajo un nombre definido en
más de un archivo (`create` en 197, `findById` en 171, `update` en 166), y de los nombres con
exactamente dos definiciones **435 son «una en cada repo»** — el gemelo. Un modelo uniendo por nombre
cablea el gemelo muerto con total confianza. Por eso cada arista lleva su **procedencia**:

| `como` | mecanismo | seguridad |
|---|---|---|
| `self` | `$this->x()` en la misma clase | declarada |
| `prop` | `$this->repo->x()` + `private LenderRepo $repo` | declarada (tipo explícito) |
| `static` | `Foo::x()` + `use App\Foo` | declarada (import explícito) |
| `ctor` | `$this->tracer->x()` + `__construct(TracerService $tracer)` | **inferida** — se asume que el parámetro y la propiedad se llaman igual |

Y si el método no está en la clase, se sube por `extends` y por los traits (en el orden de PHP: la
clase, sus traits, el padre). La arista apunta al archivo que **define** el método, no a la clase por
la que se entró — si no, el mapa manda a leer un archivo donde el método no está —, y lleva `via` con
el ancestro donde apareció. Sin ese campo, una arista hallada subiendo dos niveles se lee igual que una
declarada al lado.

Lo que no entra en ninguna forma **no se inventa**: se cuenta y se reporta. Es el mismo patrón de las
relaciones de tablas (44 FK declaradas contra 388 reconstruidas, cada una diciendo de dónde salió).

## Estado medido (legacy-backend, 2.529 archivos, 442 ms)

    10.400 métodos · 11.020 aristas · 779 casos de Pest · 362 de 397 migraciones con su tabla
    49.700 call sites → 22,2% resueltos · 1.089 de las aristas se hallaron SUBIENDO la jerarquía

| | | qué haría falta |
|---|---|---|
| `libre` — `$var->x()` sobre una local | 26.666 | inferencia de tipos. La mayoría son cadenas de Eloquent: framework, no cableado propio |
| fuera del repo (vendor) | 5.682 | nada: está bien que no sean aristas nuestras |
| método no hallado | 5.463 | la jerarquía llega a una clase base de Laravel: fuera del índice |
| propiedad sin type hint | 869 | nada barato |

### La jerarquía: el conteo es modesto, el alcance no

Subir por `extends` y traits agregó **1.089 aristas (+11%)** y 33 archivos que antes no tenían ningún
vecino saliente. El número no impresiona. Lo que cambia es la **alcanzabilidad**, que es lo único que
le importa a un enrutador:

| desde `LenderListingController` | sin jerarquía | con jerarquía |
|---|---|---|
| 2 saltos | 14 archivos | 16 |
| 3 saltos | 27 | 35 |
| **4 saltos** | **27** (saturó) | **41** |

Sin jerarquía el grafo **se queda sin camino** en el salto 3. Y los 14 archivos que sólo aparecen con
ella son el núcleo de negocio del listado:

    ProfilingRulesService · RiskCentralValidationService · LenderValidationService
    PreApprovedLenderService · LenderSpecialGrantingService · RevolvingCreditsService
    CreditopXNotificationService · CreditopXRequestHistoryService · LenderRetrievalService …

⚠ **Dos de esos cuatro archivos son los que el experimento del triaje tuvo que rescatar a mano**
(`ProfilingRulesService`, `LenderSpecialGrantingService`). Eran inalcanzables desde el controller y hoy
están a cuatro saltos. Eso es lo que se estaba comprando con la herencia.

El caso que la motivó, ya resuelto: `LenderListingService` pasó de 12 a **20** aristas salientes, y las
8 nuevas van al padre con los nombres del pipeline real — `validateAndProcessLenders`,
`getProfilingData`, `applyProfiling`, `applySpecialConditions`, `shouldRecommendLender`. El padre tiene
28 salientes, entre ellas `ProfilingRulesService::applyProfilingAndRiskCentralRules`.

⚠ Y un efecto lateral que vale como control: el tier `ctor` —la única procedencia **inferida**— cayó de
3.926 a **16**. No se perdió nada: esas propiedades ahora se resuelven por la declaración real en el
padre. La inferencia era un parche por no tener jerarquía.

⚠ Los dos que más aportaron son plomería, no negocio: el trait `ApiResponse` (699 aristas) y
`BaseService` (274). Un conteo de aristas sin mirar QUÉ conecta habría dicho que la herencia sirve para
las respuestas HTTP.

## LA PRUEBA DE FUEGO — y la tesis salió corregida

    python3 prueba.py A B D        # 7 preguntas × 3 condiciones. B cuesta 7 × 265k tokens de entrada

El mapa se vendía como enrutador: le da a un seleccionador lo suficiente para decidir qué leer, más
barato que los archivos. Para poder refutarlo hace falta la condición de control que casi nadie corre:
**la lista pelada de rutas**. Si con 2.529 nombres de archivo alcanza, el esqueleto no se gana sus
266.000 tokens.

Las 7 preguntas tienen verdad de referencia sacada con `git grep` contra `main` — **no** elegida por lo
que el mapa sabe contestar. Tres discriminantes (el nombre no delata), dos de **nivel método**, una de
**techo** (el dato está en el cuerpo, ninguna condición lo tiene) y un **control negativo** (Nequi no
existe en el repo: la respuesta correcta es «no está»).

| | A · sólo rutas | B · mapa escalonado | D · rutas + esqueleto a demanda |
|---|---|---|---|
| payload | ~39.000 tok | ~265.000 tok | ~39.000 + ~4.000 |
| `can_check_preapproval` | ✓ 2/3 | ✓ 2/3 | ✓ 2/3 |
| `profiling_reviews` | ✓ 2/9 | ✓ 3/9 | ✓ 1/9 |
| **`recalculate` (método)** | **✗** | ✓ | ✓ |
| **`getLenderUserCategory` (método)** | **✗** | ✓ | ✓ |
| `ambiente_identidad` (techo) | 3/4 en #4 | 3/4 en #5 | 3/4 en **#1** |
| `soap_envelope` (control fácil) | ✓ | ✓ | ✓ |
| `nequi` (control negativo) | ✓ no inventó | ✓ | ✓ |
| **total** | **5/7** | **7/7** | **7/7** |
| archivos elegidos (promedio) | 6,5 | 4,8 | 4,7 |

### Lo que esto dice, y no es lo que yo esperaba

**1 · La lista de rutas es una línea base brutal.** Acierta 5 de 7 con 39k tokens, y en las
discriminantes empata con el mapa completo. La razón es que **las convenciones de nombres de Laravel
llevan casi toda la señal de ruteo**: `RiskCentralValidationService.php` ya dice qué hace. ⚠ Eso
también marca el límite de generalizar esto: en un repo con nombres pobres el orden podría invertirse.

**2 · El esqueleto gana en un eje, y es nítido: las preguntas de nivel MÉTODO.** A encontró el archivo
correcto en el puesto #1 las dos veces y **devolvió la lista de métodos vacía en vez de inventar** —
no tenía el dato. Con esqueleto, las dos con el nombre exacto. Y se ve que lo leyó: en `soap_envelope`
citó `createEnvelope`, `buildSignedEnvelope`, `renderUnsignedEnvelope`, `BinarySecurityToken`.

**3 · La conclusión de diseño: el mapa no va como PAYLOAD, va como HERRAMIENTA.** B no necesitaba los
esqueletos de los 2.529 archivos: necesitaba los de los pocos candidatos que estaba mirando. D pide en
promedio 7 archivos (~4.000 tokens) y empata con B a **1/6 del costo**. El payload de 265k que este
proyecto construyó primero es la forma equivocada de entregar lo mismo.

**4 · El techo se confirmó.** `ambiente_identidad` da 3/4 en las tres condiciones, porque
`app()->environment([...])` vive en el cuerpo de los métodos y ninguna representación de firmas lo
tiene. Las tres aciertan por inferencia de nombre. Esa pregunta midió suerte de nomenclatura, no mapa —
y hace falta tenerla para saber dónde está el borde.

⚠ **Los límites de este experimento**: 7 preguntas, un modelo, un repo. No es un benchmark. Y la verdad
de referencia son «los archivos que nombran la cosa literalmente», un sesgo con el que ya me tropecé
una vez —  la primera versión truncó el GT con un `head -4` y dejó afuera `app/Models/ProfilingReview.php`,
que era la mejor respuesta posible.

## El grep pone la intención, el grafo el vecindario

    demo can_check_preapproval        # 1 salto, 25k tokens de presupuesto

La conclusión de la prueba de fuego, aplicada: el mapa **no va como contexto inicial**. La semilla la
pone la pregunta —lo que matcheó un `git grep`— y el grafo agrega sólo lo que está pegado a eso,
renderizado con los tiers y con un presupuesto que **dice** cuándo cortó.

**Lo que aporta sobre el grep solo**, que es la única razón para que exista: el archivo que **no
matcheó** pero está a un salto. Grepeando `can_check_preapproval` (5 semillas) aparece a un salto
`ProfilingRulesService` — que **no contiene el término** y es uno de los cuatro archivos que el
experimento del triaje tuvo que rescatar a mano. También aparece `LenderRetrievalService`, el padre
donde vive el pipeline.

Y de arriba viene gratis la prosa de los tests. El vecindario de `can_check_preapproval` trae:

    · no pisa un true ya asignado por RiskCentralValidationService
    · marca false cuando el score está bajo el umbral
    · marca false cuando no hay fila en lender_datacredito_rules

La última nombra una tabla que ni el grep ni el esqueleto te habrían dado.

### ⚠ El acantilado del segundo salto, medido

| término grepeado | semillas | +1 salto | +2 saltos | +3 |
|---|---|---|---|---|
| `can_check_preapproval` | 5 | **7** | 198 | 399 |
| `profiling_reviews` | 9 | **12** | 309 | 333 |
| `stampCreditopXApproval` | 1 | **6** | 199 | 400 |
| `createEnvelope` | 2 | **2** | 2 | 15 |
| `lenders_by_allied_branches` | 17 | **39** | 342 | 311 |

**Un salto: 2 a 39 archivos, todos del vecindario real. Dos saltos: 198 a 342.** A 2 saltos desde
`stampCreditopXApproval` entran servicios de OTP, de ecommerce y contadores de consultas a Experian: el
fan-out del padre arrastra el módulo entero. El default es 1 salto y `--hops 2` avisa con estos
números.

⚠ **Resultado negativo del ranking**: a 1 salto la **co-activación no dispara**. Con las 5 semillas de
`can_check_preapproval`, a cada uno de los 7 vecinos lo toca UNA sola semilla — el grafo es demasiado
ralo (77,8% de los call sites sin resolver) para que compartan vecinos. Recién aparece a 2 saltos, que
es donde el vecindario ya no sirve. El criterio quedó en el código con esa advertencia escrita, para
que nadie crea que está rankeando algo.

## Por qué Go, y por qué no hay motor de grafos

Cuando hace falta el repo entero, los 2.529 archivos se parsean en paralelo —un parser de tree-sitter
por goroutine— en **~500 ms**. Eso es lo que hace que **no exista archivo de índice**: cachear en disco
resolvía un problema que no existe, y traía el que sí existe —un caché que envejece sin avisar.

Para el caso normal ni eso: el grep decide qué parsear y son decenas de archivos.

**AST, no regex.** El techo del extractor de `workers` está medido: 11 archivos contra los 22 de `git
grep`. La mitad de las aristas se pierde, y en silencio. Este mapa ya pagó esa lección dos veces:
`base_clause` no es un *field* en esta gramática (el campo `extiende` quedó vacío en los 2.529 archivos
sin que nada fallara) y los tests de Pest no declaran métodos.

**Sin motor de grafos, a propósito.** Son ~10⁴ aristas: un `map[string][]arista` responde cualquier
travesía en microsegundos. Si algún día hace falta Cypher, el candidato es KùzuDB (embebido, un
archivo) — y cambiar significa tocar sólo `grafo.go`.

## Lo que falta, en orden de rendimiento

1. **Otros lenguajes.** Hoy sólo PHP. La forma es la misma para TS y Go —tree-sitter tiene gramáticas—
   pero el resolvedor por grep cambia por lenguaje (`class X` no es cómo se declara en Go).
2. **Las columnas de las migraciones**, no sólo la tabla: `$table->string('x')` está a un nodo de distancia.
3. **`new Foo()` y `app(Foo::class)`** en locales: es el bucket más grande (26.666).
4. **El front.** En `.tsx` la compresión medida es sólo 3,9x: el esqueleto no captura
   JSX ni hooks, así que el front necesita otra estrategia.
5. **Cablear esto en `seleccion.py`** de `workers`: la herramienta `esqueleto(rutas)` al lado del índice
   que ya tiene, en vez del payload. Es lo que la prueba de fuego dejó demostrado.
6. **Más preguntas de nivel método**, que es el único eje donde el esqueleto ganó. Siete no alcanzan
   para afirmar una tasa.
