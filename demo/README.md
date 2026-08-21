# demo · el mapa de cableado

Prototipo. **NO es fuente de contexto** (ver el `CLAUDE.md` de la raíz): es un experimento para medir
si un mapa de *esqueletos + aristas resueltas* puede reemplazar al payload de archivos enteros que hoy
recibe `agente-lector`.

    make demo-roots                  # deriva roots.json de context/tools/roots.py (una vez)
    make demo-extraer                # construye el mapa de legacy-backend (~0,5 s)
    make demo-medir                  # los números
    make demo-mapa   F=<alias/ruta>  # un archivo → su detalle · un PREFIJO → el mapa del módulo
    make demo-vecinos F=<alias/ruta> # quién lo llama y a quién llama, con la procedencia de cada arista

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
`Modules/Risk` son 45 archivos y **8.390 tokens**; `Modules/Onboarding`, ~38.700. `make demo-mapa`
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
| `codigo` | la firma completa de cada método + qué inyecta | el default |
| `test` | los nombres de método **y las descripciones de Pest** | 1,5x más barato que su esqueleto |
| `migracion` | el archivo + **las tablas que toca** | las firmas `up()`/`down()` son ~19.000 tokens de cero información |

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
| `interno` | `$this->x()` en la misma clase | declarada |
| `prop` | `$this->repo->x()` + `private LenderRepo $repo` | declarada (tipo explícito) |
| `estatico` | `Foo::x()` + `use App\Foo` | declarada (import explícito) |
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

## Por qué Go, y por qué no hay motor de grafos

Los 2.529 archivos se leen de `main` con **un** `git cat-file --batch` (no 2.529 `git show`) y se
parsean en paralelo, un parser de tree-sitter por goroutine: **458 ms**. Se reconstruye entero en vez de
mantener un caché que envejece.

⚠ **Se lee `main`, no el working tree.** Los repos viven en ramas: un indexador que caminara el disco
habría borrado `Modules/Backoffice` del mapa sin que nada avisara.

**AST, no regex.** El techo del extractor de `workers` está medido: 11 archivos contra los 22 de `git
grep`. La mitad de las aristas se pierde, y en silencio. Este mapa ya pagó esa lección dos veces:
`base_clause` no es un *field* en esta gramática (el campo `extiende` quedó vacío en los 2.529 archivos
sin que nada fallara) y los tests de Pest no declaran métodos.

**Sin motor de grafos, a propósito.** Son ~10⁴ aristas: un `map[string][]arista` responde cualquier
travesía en microsegundos. Si algún día hace falta Cypher, el candidato es KùzuDB (embebido, un
archivo) — y cambiar significa tocar sólo `grafo.go`.

## Lo que falta, en orden de rendimiento

1. **Las columnas de las migraciones**, no sólo la tabla: `$table->string('x')` está a un nodo de distancia.
2. **`new Foo()` y `app(Foo::class)`** en locales: es el bucket más grande (26.666).
3. **El otro monolito y el front.** En `.tsx` la compresión medida es sólo 3,9x: el esqueleto no captura
   JSX ni hooks, así que el front necesita otra estrategia.
4. **La prueba de fuego**: darle a `seleccion.py` el mapa en vez del índice y correr el control negativo
   del triaje — sacar a propósito el archivo que contesta y ver si el mapa lo rescata.
