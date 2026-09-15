---
id: 85
title: "Los CLAUDE.md: la regla vigente sola, y la historia donde va la historia"
stage: evaluation
created: "2026-09-14T22:50:00-05:00"
context_nodes: [findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Los cuatro `CLAUDE.md` (raíz, `tablero/`, `context/`, `harness/`) tienen la misma enfermedad que se
diagnosticó en las tareas el 19/8: **mezclan el estado vigente con el registro de cómo se llegó**. Cada
vez que una afirmación resultó falsa se corrigió *inline* —«(Acá decía X. Está mal, medido el día Y…)»—
y la corrección se quedó al lado de la regla. Quien lee tiene que descubrir cuál de las dos versiones
vale. Medido el 2026-09-14: **10 correcciones inline** (8 en la raíz, 1 en tablero, 1 en harness), 17
fechas en la raíz, y unos **10.000 tokens de arranque por sesión** (7.000 del `CLAUDE.md` raíz + 3.200
del catálogo del hook). Las rutas que citan están sanas (3 muertas de 118), así que el problema NO es
que mientan por rutas viejas: es que crecen por historia. El inventario de cada corrección y a dónde
graduaría está abajo. **Nada de esto se reescribió todavía**: son textos de Miguel y la reescritura es
su decisión; lo que hay es el mapa para hacerla.

**El próximo paso es:** decidir el destino de las 10 correcciones (F-xx nuevo · anotación con fecha
en su sección · borrar porque ya está en un hallazgo) y reescribir la raíz dejando **sólo la regla
vigente** con un puntero al hallazgo.

## Objetivo

Que cada `CLAUDE.md` diga **lo que vale hoy**, en el menor texto posible, y que la lección de cada
corrección quede donde el sistema guarda lecciones: `context/server/data/flows/findings/doc.md`
(F-xx) o una anotación con fecha. Sin perder ninguna: cada «acá decía» costó un error real.

## Dónde se toca

- `CLAUDE.md` (raíz): líneas 83, 101, 139, 256, 300, 337, 347 y la sección ⛔ de PHPUnit.
- `tablero/CLAUDE.md`: línea 203 (transiciones de Jira).
- `harness/CLAUDE.md`: línea 228 (LocalStack vs MinIO).
- `context/server/data/flows/findings/doc.md`: destino de las lecciones que aún no son F-xx.

## Cómo se ataca

Inventario, con destino propuesto:

| # | archivo:línea | qué corrige | destino propuesto |
|---|---|---|---|
| 1 | raíz:83 | `Modules/Backoffice` ya está en `develop`; el ejemplo caducó | **borrar** el paréntesis: la regla general (`git ls-tree` antes de depurar un 404) queda sola |
| 2 | raíz:101 | CORE-431 ya no está abierta: la guarda en `CreatesApplication.php` | la regla queda; la historia (PR 1140, cómo funciona la guarda) ya vive en `tablero/data/tests-pueden-borrar-la-bd-compartida.md` → **puntero** |
| 3 | raíz:139 | «hoy NINGUNO» era falso: `git grep` no entiende `\s` | **F-xx nuevo**: «`git grep` no entiende `\s`; POSIX `[[:space:]]`» — es una trampa del sistema, generaliza |
| 4 | raíz:256 | `cuadrilla` se mudó al repo compartido | **borrar** el paréntesis: la lista de carpetas de exploración ya no la incluye |
| 5 | raíz:300 | el `\|\|=` de `E2E_TARGET` perdía contra el import estático | ya es **F-187** → dejar la regla en una línea + puntero |
| 6 | raíz:337 | `staging` → rama `staging`, no `qa` | **anotación** `> **DECISIÓN · 2026-08-14 · Miguel**` en la tabla de ambientes; el paréntesis se va |
| 7 | raíz:347 | `APP_ENV` de staging en disputa (`develop` vs `development`) | es una **pregunta abierta**: `> **PREGUNTA · 2026-09-07 · infra**` con el `Como` (medir el valor efectivo en el servicio); la deducción de 2026-08-14 va al hallazgo |
| 8 | raíz ⛔ PHPUnit | tres párrafos de «acá decía» sobre el conteo de `RefreshDatabase` | la regla vigente + el hook `tests-destructivos.py` bastan; la historia de los conteos falsos → **F-xx** (mismo que el 3) |
| 9 | tablero:203 | «En pruebas» sólo se llega desde «Terminada» | **anotación** `> **MEDICIÓN · 2026-08-19**` con el `GET /issue/{key}/transitions` como `Como` |
| 10 | harness:228 | LocalStack ≠ MinIO: no alcanza con `AWS_ENDPOINT` | ya está redactado como regla vigente en mayúsculas; sólo **bajar el tono** y dejar el porqué |

Después de la pasada, medir de nuevo: palabras por archivo y tokens de arranque.

## Lo que se evaluó y NO se eligió

- **Recortar contenido para bajar tokens.** No: cada regla costó un error. Lo que crece es la
  *historia* de la regla, no la regla.
- **Un `CHANGELOG.md` para las correcciones.** Duplicaría el mecanismo de `findings` (que ya tiene
  índice de síntomas y se lee antes de depurar) y nadie lo abriría.
- **Reescribirlo en esta sesión.** Son textos de Miguel; el mapa se puede hacer solo, la voz no.

## Lo que está decidido

> **DECISIÓN · 2026-09-14** — la regla que gobierna es la misma de las tareas: ESTADO se reescribe, REGISTRO se apila en otro lado. Un `CLAUDE.md` es estado.

## Riesgos

> **RIESGO · 2026-09-14** — al mover una corrección a `findings`, el `CLAUDE.md` pierde el «por qué» que hoy evita repetir el error. Cada regla que quede tiene que llevar el puntero al F-xx, no sólo borrarse el paréntesis.

## Lo que NO entra

Cambiar reglas. Sólo separar la vigente de su historia.

## Cómo se comprueba

    for f in CLAUDE.md tablero/CLAUDE.md context/CLAUDE.md harness/CLAUDE.md; do
      printf "%3s correcciones inline · %5s palabras  %s\n" \
        $(grep -c -i 'acá decía\|está mal\|ya no:\|caducó\|era falso\|es mentira\|fue FALSO' $f) $(wc -w < $f) $f
    done

> **MEDICIÓN · 2026-09-14** — raíz: 8 correcciones inline, 4.344 palabras · tablero: 1, 4.069 · context: 0, 3.722 · harness: 1, 9.159. Arranque por sesión ≈ 7.085 + 3.251 tokens (raíz + catálogo del hook).
> `wc -c CLAUDE.md` / 4, y el stdout del hook `herramientas.py` / 4

## Registro

### 2026-09-14

Inventario medido de las 10 correcciones inline y de las rutas citadas (118, 3 muertas). Destinos
propuestos en la tabla. No se reescribió nada.

## Tarea (publicable)

## En una línea
Las guías de trabajo dicen sólo lo que vale hoy, y la historia de cada corrección vive en el registro de hallazgos.

## Por qué
Cada vez que una guía resultó equivocada se corrigió al lado de la regla, y hoy quien lee tiene que
descubrir cuál versión vale.

## Cómo validar
Abrir una guía y no encontrar ninguna corrección del tipo «acá decía»; cada regla con historia apunta a
su hallazgo.
