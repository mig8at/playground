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

Lo que no entra en ninguna forma **no se inventa**: se cuenta y se reporta. Es el mismo patrón de las
relaciones de tablas (44 FK declaradas contra 388 reconstruidas, cada una diciendo de dónde salió).

## Estado medido (legacy-backend, 2.529 archivos)

    10.277 métodos · 9.931 aristas · 779 casos de Pest · 362 de 397 migraciones con su tabla
    49.700 call sites → 20,0% resueltos

El 80% sin resolver, desglosado:

| | | qué haría falta |
|---|---|---|
| `libre` — `$var->x()` sobre una local | 26.666 | inferencia de tipos. La mayoría son cadenas de Eloquent: framework, no cableado propio |
| **heredado/trait** | 6.552 | **seguir `extends`. LA PALANCA: 1.002 de 2.529 archivos (40%) heredan** |
| fuera del repo (vendor) | 5.682 | nada: está bien que no sean aristas nuestras |
| propiedad sin type hint | 869 | nada barato |

⚠ **El caso que valida el diseño**: `LenderListingService` inyecta 10 servicios y el mapa le resuelve 12
aristas, ninguna a `ProfilingRulesService` ni a `RiskCentralValidationService`. Verificado a mano, el
mapa **tiene razón**: la clase no los llama, los pasa a `parent::__construct` — viven en
`LenderRetrievalService`, que tiene los 21. El bucket honesto de «no resolví» apuntó exacto al
mecanismo que falta, en vez de inventar una arista.

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

1. **Herencia** — seguir `extends` para métodos y props. Toca el 40% de los archivos y 6.552 call sites.
2. **Traits** — `use X;` dentro de la clase (hoy se confunde con el import).
3. **Las columnas de las migraciones**, no sólo la tabla: `$table->string('x')` está a un nodo de distancia.
4. **`new Foo()` y `app(Foo::class)`** en locales: parte del bucket `libre`.
5. **El otro monolito y el front.** En `.tsx` la compresión medida es sólo 3,9x: el esqueleto no captura
   JSX ni hooks, así que el front necesita otra estrategia.
6. **La prueba de fuego**: darle a `seleccion.py` el mapa en vez del índice y correr el control negativo
   del triaje — sacar a propósito el archivo que contesta y ver si el mapa lo rescata.
