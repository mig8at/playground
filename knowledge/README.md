# Conocimiento local del taller

Archivos editables y versionados para trabajar con las herramientas de Miguel. Los nombres de archivos
y carpetas van en inglés; las explicaciones quedan en español. No necesita servidor, VPN ni Canon.

Cada tema tiene dos piezas:

```text
knowledge/
  lender-listing/
    rules.md
    sources.json
```

`rules.md` explica reglas y límites. `sources.json` conserva título, resumen, fecha de revisión y, por
sección, repositorio, archivo, commit y hash del blob revisado. Los temas se extraen del trabajo del tablero y
cubren mecanismos acotados: su alcance y sus límites aparecen antes de las reglas.

```sh
make knowledge-map
make knowledge-search Q='monto listado'
make knowledge-read ID=lender-listing
make knowledge-check
make retomar N=96
```

Una tarea declara `knowledge: [lender-listing]`. La retoma lee esos temas completos o secciones exactas,
y avisa qué falta o excede el presupuesto. No consulta Canon por defecto.

`knowledge-check` compara los blobs revisados con `main`/`origin/main` disponibles en los clones
locales de `tools/repos.json`; no hace fetch. Falla si una fuente cambió, no existe o no se puede comprobar.
Un resultado verde sólo significa que esos archivos no cambiaron desde la revisión: no valida la
interpretación, otras dependencias, la configuración de un ambiente ni qué está desplegado.

La evidencia de una solicitud o un ambiente sigue en su tarea y se obtiene con trazador, harness o datos.
Canon queda como consulta opcional de negocio/producto que no se puede comprobar en local. Compartir
allí un conocimiento es una acción solicitada por separado; no existe sincronización automática.

Las reglas de edición están en [CLAUDE.md](CLAUDE.md).

## Crecer desde el trabajo diario

Al retomar una tarea, leé los temas que declara y comprobá si ayudan con la pregunta concreta.
Si falta una explicación, investigá el código y guardá sólo lo que volvería a servir en otra tarea.
Usá `make knowledge-map` para reutilizar un tema antes de abrir otro. No hace falta completar un
mapa de toda la compañía para trabajar.

El documento de tarea mantiene el objetivo, los pendientes y la receta. Su pila conserva los
casos, las mediciones y las decisiones. La biblioteca explica el mecanismo vigente en el código
revisado. Un PR sin mergear y una prueba en desarrollo conservan ese estado; no se convierten en
regla de `main` por aparecer en una tarea antigua.

Cuando cambie una fuente, revisá la explicación antes de actualizar sus hashes. Si una pregunta
depende de producto o negocio y no se puede comprobar localmente, consultá su fuente documental
—Canon puede ser una— y conservá esa incertidumbre en la tarea.
