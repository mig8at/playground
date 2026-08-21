# demo · el mapa de cableado

Prototipo. **NO es fuente de contexto** (ver el `CLAUDE.md` de la raíz): es un experimento para medir
si un mapa de *esqueletos + aristas resueltas* puede reemplazar al payload de archivos enteros que hoy
recibe `agente-lector`.

    make demo-roots                  # deriva roots.json de context/tools/roots.py (una vez)
    make demo-extraer                # construye el mapa de legacy-backend (~0,5 s)
    make demo-medir                  # los números
    make demo-mapa   F=<alias/ruta>  # el ESQUELETO de un archivo
    make demo-vecinos F=<alias/ruta> # quién lo llama y a quién llama

## La tesis, y el número que la sostiene

El lector recibe archivos **enteros** y su techo real son 35-40 antes de que recorte. Medido sobre
`legacy-backend:main`, 2.529 archivos PHP:

| | tokens |
|---|---|
| los 2.529 archivos completos | ~2.874.000 |
| los 2.529 **esqueletos** (sólo firmas) | **~336.000** |
| | **8,6x** |

En la ventana de 300k del lector caben ~264 archivos enteros. En esqueleto cabe **el repo entero**.
Y en un archivo concreto la compresión es mayor: `LenderListingService.php` pasa de ~6.440 tokens a
**537** (12x) sin perder un solo nombre de método — incluido `stampCreditopXApproval:405`, el que el
experimento del triaje tuvo que rescatar a mano.

## Lo que este mapa NO contesta

**El cableado no es el negocio.** El grafo dice que `getLenders()` llama a `applyProfilingRules()`; no
dice que perfilamiento sólo **clasifica** mientras el status de la sucursal **excluye** — y esa
diferencia, que es un `continue` contra una asignación dentro de un loop, es la respuesta a casi toda
pregunta de soporte. El significado vive en `context/` y este mapa apunta ahí.

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

## Estado medido (legacy-backend, 2.529 archivos, 458 ms)

    10.277 métodos · 9.931 aristas resueltas
    49.700 call sites → 20,0% resueltos

El 80% sin resolver, desglosado y por qué:

| | | qué haría falta |
|---|---|---|
| `libre` — `$var->x()` sobre una local | 26.666 | inferencia de tipos. La mayoría son cadenas de Eloquent/colecciones: framework, no cableado propio |
| **heredado/trait** | 6.552 | **seguir `extends`. LA PALANCA: 1.002 de 2.529 archivos (40%) heredan** |
| fuera del repo (vendor) | 5.682 | nada: está correcto que no sean aristas nuestras |
| propiedad sin type hint | 869 | nada barato |

⚠ **El caso que lo prueba**: `LenderListingService` inyecta 10 servicios y el mapa le resuelve 12
aristas, ninguna a `ProfilingRulesService` ni a `RiskCentralValidationService`. Verificado a mano, el
mapa **tiene razón**: la clase no los llama, los pasa a `parent::__construct` — vive en
`LenderRetrievalService`, que tiene los 21. El bucket honesto de «no resolví» apuntó exacto al
mecanismo que falta, en vez de inventar una arista. Eso es el diseño funcionando.

## Por qué Go, y por qué no hay motor de grafos

**Go + tree-sitter.** Los 2.529 archivos se leen de `main` con **un** `git cat-file --batch` (no 2.529
`git show`) y se parsean en paralelo, un parser por goroutine: **458 ms**. Se reconstruye entero en vez
de mantener un caché que envejece.

⚠ **Se lee `main`, no el working tree.** Los repos viven en ramas: un indexador que caminara el disco
habría borrado `Modules/Backoffice` del mapa sin que nada avisara.

**AST, no regex.** El techo del extractor de `workers` está medido: 11 archivos contra los 22 de `git
grep`. La mitad de las aristas se pierde, y en silencio.

**Sin motor de grafos, a propósito.** Son ~10⁴ aristas: un `map[string][]arista` responde cualquier
travesía en microsegundos. Un motor cobraría una dependencia y un lenguaje de consulta para un
problema que no existe a esta escala. Si algún día hace falta Cypher, el candidato es KùzuDB
(embebido, un archivo) — y cambiar significa tocar sólo `grafo.go`.

## Lo que falta, en orden de rendimiento

1. **Herencia** — seguir `extends` para métodos y props. Toca el 40% de los archivos y 6.552 call sites.
2. **Traits** — `use X;` dentro de la clase (hoy se confunde con el import).
3. **`new Foo()` y `app(Foo::class)`** en locales: parte del bucket `libre`.
4. **El otro monolito y el front.** En `.tsx` la compresión medida es sólo 3,9x: el esqueleto no captura
   JSX ni hooks, así que el front necesita otra estrategia.
5. **La prueba de fuego**: darle a `seleccion.py` el mapa en vez del índice y correr el control negativo
   del triaje — sacar a propósito el archivo que contesta y ver si el mapa lo rescata.
