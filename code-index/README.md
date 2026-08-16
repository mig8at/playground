# code-index · cómo están CONSTRUIDOS los proyectos

El índice que entra **por repo**. Qué es cada proyecto de CreditOp, con qué está hecho, **cuándo nació**,
cómo se ensambla y los pocos archivos que lo explican de un vistazo. Pensado para dárselo entero a un
agente y que **elija** qué abrir.

```bash
make code-index                                  # todo
make code-index ALIAS=frontend-monorepo          # uno
make code-index-subramas ALIAS=legacy-backend    # las unidades de adentro
make code-index PUENTE=1                         # cobertura del árbol de negocio por repo
make code-index CHECK=1                          # ¿siguen vivas las rutas en main?
```

## Por qué es un proyecto aparte y no vive en `context/`

Son **dos preguntas distintas**, y se notó al chocar dos veces:

| | pregunta | entrada |
|---|---|---|
| `context/` | **¿cómo FUNCIONA CreditOp?** (negocio) | por síntoma → nodo |
| `code-index/` | **¿cómo están CONSTRUIDOS los proyectos?** (arquitectura) | por repo |

Y las reglas difieren de verdad, no por gusto: `context/tools/oracle.py` dropea `.md`, `.sql` y `.yaml`
**a propósito**, porque el mapa de un nodo indexa código y esa regla evita que se llene de migraciones.
Acá el `composer.json`, el `turbo.json`, el `openapi.yaml` y el ADR **son** la respuesta. Distinta
pregunta, distinta regla, validador propio.

⚠ **La dependencia va en un solo sentido: `code-index` lee `context/`** (su `roots.py` y sus `map.json`)
**y `context/` no sabe que esto existe.** Es la misma regla que ya rige entre el tablero y los nodos: el
enlace unidireccional evita que al mover una pieza la otra quede mintiendo.

## Las tres capas

**1 · El repo** — a mano, en `repos.json`. Qué es, stack, cuándo nació, cómo se ensambla, y 3-6 archivos
de entrada con **por qué** cada uno. Criterio: *si leo esto, entiendo cómo se arma*. Si un archivo no
cambia lo que harías, no va — `context/tools/index.txt` ya tiene miles de rutas y por eso no sirve para
elegir.

**2 · Las subramas** — **derivadas**, nunca escritas. Las unidades con **ensamblado propio** de adentro:
los workspaces del monorepo (25) y los módulos de Laravel (20). Se descubren leyendo `main`.

> ⚠ **De `main`, no del working tree.** Medido el 2026-08-15: `legacy-backend` estaba checkeado en una
> rama donde `Modules/Backoffice` **no existe**. Un descubridor que caminara el disco lo habría borrado
> del índice sin que nada avisara — justo el módulo que sólo vive en `main`.

Una subrama se gana el lugar cuando **tiene ensamblado propio** (manifiesto, punto de entrada), no
cuando es una carpeta. Por eso `application` da **cero** y está bien: es Laravel plano.

**3 · El puente** — **derivado** también: qué nodos de `context/` describen cada repo. Cada `map.json` ya
lista sus archivos como `alias/relpath`, así que la pertenencia estaba en los datos; sólo faltaba leerla
al revés. Un nodo nuevo aparece solo.

**4 · El mapa de negocio** — `make code-index-mapa ALIAS=…`. Cruza las capas 2 y 3: para **cada unidad**
del repo, qué nodos de negocio la citan. Es la respuesta a *«en el monorepo hay cosas separadas:
bancolombia, backoffice, onboarding…»* — cierto, y **ya estaba en los datos dos veces**: el repo lo
separa en carpetas y el árbol lo separa en nodos. Sólo faltaba cruzarlos.

```
apps/backoffice                              backoffice (56)
modules/…/bancolombia-origination            bancolombia (48)
modules/…/loan-application-form              onboarding (15)
Modules/Loans          (legacy-backend)      formalization (47) · smartpay (19) · profiling (14)
```

⚠ Escribir esto a mano —un `map.json` por área y por repo— sería una **tercera copia**, y la primera en
pudrirse porque nadie la regenera. Además el comando mide **lo que NO está cubierto**: hoy 19 de 25
unidades del monorepo tienen nodo que las describa; las otras 6 son plomería o negocio sin escribir.

## La regla que gobierna todo esto

> **Lo que se puede derivar, no se escribe.** Sólo se escribe a mano lo que ninguna máquina puede
> deducir: **por qué** algo importa.

Por eso `repos.json` tiene prosa y `notas_de_subramas`, y nada más. Todo lo demás sale de `main` en el
momento — y por eso no se pudre.

## Mantenimiento

`make code-index CHECK=1` valida que las rutas escritas a mano sigan existiendo en `main`; sale 1 si
alguna murió. **Un índice que apunta a un archivo que ya no está es peor que no tenerlo**, porque un
modelo lo abre, no lo encuentra y concluye cualquier cosa.

Las otras dos capas no necesitan mantenimiento: se derivan.
