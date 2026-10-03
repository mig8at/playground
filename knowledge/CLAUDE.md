# Contrato del conocimiento local

Guardá sólo explicaciones reutilizables que ahorren investigar y tengan un alcance claro. Cada tema
usa un nombre en inglés con minúsculas y guiones, `rules.md` y `sources.json`. Prosa en español.
No reconstruyas el antiguo servicio context/ ni importes el corpus productivo completo.

## Revisar y escribir

1. Leé el código real contra la ref local de `main` que devuelve `go run ./cmd/repos ref <alias>`
   desde `tablero/server`. Si una regla cruza ambos monolitos, revisá ambos y distinguí sus entradas.
2. Escribí el mecanismo, las condiciones y sus límites. Cada `##` genera un ancla; no repitas títulos.
   El `#` inicial debe coincidir con `title` de los metadatos.
3. Registrá `version: 1`, `title`, `summary`, `reviewedAt` en RFC3339, y `sources`: cada fuente lleva
   `repo` (alias de tools/repos.json), `path` relativa al repo, `commit` y `blob` completos, y `sections`
   (anclas de los encabezados que respalda). Toda sección necesita fuentes. Obtener un hash no sustituye
   haber leído el archivo y comprobado la afirmación.
4. Corré `make knowledge-check`. Si cambia una fuente, releé el diff y la sección antes de actualizar
   el commit y el blob. No selles automáticamente una explicación porque el archivo siga existiendo.

Las refs locales pueden estar atrasadas. Usá la ref y fecha visibles en la comprobación como límite;
si la tarea exige verificar el remoto, actualizá el clon por el procedimiento normal y repetí el chequeo.

## Separar el mecanismo de la evidencia de un caso

Las hipótesis, los PR sin mergear y las decisiones de una tarea viven en su documento o pila, con ese
estado explícito. Datos personales, secretos y volcados de producción no entran a esta biblioteca.
Los resultados del harness y las mediciones del trazador siguen siendo evidencia del ambiente medido.

Para políticas o conocimiento de negocio/producto sin comprobación local, Canon o documentos del equipo
son fuentes opcionales: citá cuál usaste y qué no verificaste. No conviertas una explicación de Canon
en hecho técnico sin contrastarla. Si hace falta guardar ese contexto, distinguí su fuente documental
del mecanismo respaldado por código; el lector actual exige fuentes Git para los temas técnicos.

## Uso y cierre

Agregá `knowledge: [topic]` o `knowledge: [topic#ancla]` a las tareas que lo necesiten. Citá el archivo
en los bloques con `[texto](repo:playground/knowledge/topic/rules.md#L1)` para fijarlo a su commit.
Un tema ausente o que excede el presupuesto se avisa; no se reemplaza por una búsqueda parecida.
Los contratos de una herramienta se mantienen junto a ella, en su CLAUDE.md.

Canon conserva el conocimiento compartido del equipo. Consultarlo es opcional; publicar allí requiere
una solicitud de Miguel, y no condiciona el cierre. La copia tablero/canon/ es histórica y no se edita
ni se sincroniza hacia knowledge/. Esta biblioteca depende de archivos locales y fuentes comprobables.
