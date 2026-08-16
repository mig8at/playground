# code-index · cómo están CONSTRUIDOS los proyectos

El índice que entra **por repo**. Qué es cada proyecto de CreditOp, con qué está hecho, **cuándo nació**,
cómo se ensambla y los pocos archivos que lo explican de un vistazo. Pensado para dárselo entero a un
agente y que **elija** qué abrir.

**Es un CLI, no un puñado de targets de `make`** — porque la usa tanto una persona como un modelo, y
un modelo necesita **descubrirla**. `--help` lista los subcomandos; `<subcomando> --help`, sus opciones
con los valores válidos. La ayuda es la documentación y no se desincroniza, porque sale del código que
corre. Todo acepta `--json`.

```bash
cd code-index
./cli.py --help                       # qué sabe hacer
./cli.py repos frontend-monorepo      # qué es y por dónde entrar
./cli.py subramas legacy-backend      # las unidades de adentro
./cli.py mapa frontend-monorepo       # qué parte del negocio vive en cada unidad
./cli.py buscar "firma pagaré"        # describís y te da archivos
./cli.py extraer legacy-backend --zoom 2   # la forma del repo, del CÓDIGO
./cli.py puente                       # cobertura del árbol por repo
./cli.py check                        # ¿siguen vivas las rutas escritas a mano?
```

Desde la raíz, `make code-index` muestra esa misma ayuda (y `ARGS='…'` reenvía) — así aparece en el
catálogo que el hook inyecta, sin duplicar la interfaz.

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

**4 · El mapa de negocio** — `./cli.py mapa <alias>`. Cruza las capas 2 y 3: para **cada unidad**
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

**5 · La extracción** — `./cli.py extraer <alias>`. Lee el CÓDIGO y saca por archivo qué **define**,
qué **importa** y qué **rutas HTTP** expone. Es lo único que no depende de que alguien haya escrito
nada: sale del código mismo. Algoritmo portado de `carto`, adaptado a PHP/Laravel, TypeScript y Go.

Puntúa por cuánta estructura tiene cada archivo y llena hasta un presupuesto en KB — y cuando corta,
lo dice. `--zoom N` no filtra: agrupa en carpetas de N niveles, que es la única forma de entender un
repo de miles de archivos (todo `legacy-backend` en diez líneas y 1,3 s).

**6 · La capa de CreditOp** — `extraer` es **genérico** a propósito: no sabe nada de este negocio, y
por eso se probó igual en PHP, TypeScript y Go. Encima corre `creditop.py`, que traduce lo extraído a
lo que acá significa algo:

```
Modules/Onboarding/App/Services/OnboardingService.php
   [com. Amoblando Pullman] [com. DENTIX/DFS] · rt=2
   tablas: lenders_by_allied_branches, user_requests · ⚠ bifurca por AMBIENTE
```

De «1960 líneas, 28 definiciones» a una descripción de nodo, derivada del código. Habilita
`--lender 160` · `--allied 94` · `--rt 2` · `--tabla profiling_reviews` · `--marca QUOTA_CHECK_REJECTED`
· `--gates` (los que bifurcan por ambiente: **la trampa de staging**, que corre con `APP_ENV=development`).

⚠ Va **separado** y no adentro del extractor por dos razones: aquél sigue sirviendo para cualquier
repo, y —más importante— meterle negocio lo volvería un **segundo lugar donde vive ese conocimiento**,
compitiendo con `context/`. El diccionario (`creditop.json`) declara de qué nodo salió cada grupo; ante
una diferencia **manda el nodo**.

**7 · El índice de tags** — `./cli.py tags --construir` recorre los 12 repos y arma
`{sha: [tags]}`: qué lender, qué comercio, qué `response_type`, qué tabla, qué marcador de log y si
bifurca por ambiente. 1.514 entradas, 63 KB, 2,5 s. Después `--tag lender:160` responde en 0,2 s.

⚠ **La llave es el sha del CONTENIDO, no el de la ruta**, y ésa es la decisión que hace que no se
pudra: con hash de ruta, un archivo modificado deja los tags viejos y **nada lo detecta**; con hash de
contenido el archivo cambiado tiene otra llave, así que el caché **no puede devolver algo viejo** —
simplemente no matchea y se recalcula. Se autoinvalida. De yapa, los archivos idénticos entre repos
comparten entrada (hay 321 entre los dos monolitos).

El nodolite lleva `p` (ruta) **y** `h` (sha corto). El hash **no reemplaza** a la ruta: la ruta es lo
que dice de qué trata un archivo antes de abrirlo; el hash es sólo la llave para machear.

`./cli.py tags` sin argumentos lista **qué tags existen y cuántos archivos tiene cada uno** — que
terminó siendo un censo del código por concepto de negocio, algo que nadie había contado:

```
lender:  credifamilia(182) · meddipay(59) · smartpay(48) · credipullman(37)
tabla:   user_requests(202) · risk_central_user_data(56) · user_field_values(29)
gates:   93 archivos bifurcan por AMBIENTE
rt:      2(83) · 3(42) · 0(22) · 1(18) · 4(8)
```

## La regla que gobierna todo esto

> **Lo que se puede derivar, no se escribe.** Sólo se escribe a mano lo que ninguna máquina puede
> deducir: **por qué** algo importa.

Por eso `repos.json` tiene prosa y `notas_de_subramas`, y nada más. Todo lo demás sale de `main` en el
momento — y por eso no se pudre.

## Mantenimiento

`./cli.py check` valida que las rutas escritas a mano sigan existiendo en `main`; sale 1 si
alguna murió. **Un índice que apunta a un archivo que ya no está es peor que no tenerlo**, porque un
modelo lo abre, no lo encuentra y concluye cualquier cosa.

Las otras capas no necesitan mantenimiento: se derivan de `main` en el momento.
