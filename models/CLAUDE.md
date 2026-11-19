# models — qué modelo de IA usa cada herramienta

**Para qué existe:** saber qué modelos hay en esta máquina (la Mac o el PC: `lib/machine`; cada una tiene los suyos), cuánto ocupan y cuáles usa una herramienta, para borrar sin dudar
lo que nadie usa (Miguel, 2026-11-19: «un CLI, algo más tipo consola que podamos usar fácilmente desde nuestras
herramientas locales»). Lo que no está en el registro no lo usa nadie.

    bin/models list [--json]          lo instalado, con tamaño y qué herramienta lo usa
    bin/models unused [--json]        lo que ninguna herramienta usa: se puede borrar
    bin/models path point             las rutas que abre una herramienta (también por modelo o por clave), una por línea
    bin/models rm <clave> [--force]   borra; si una herramienta lo usa, pide --force
    bin/models replace --tool sentinel --old amazon/chronos-2 --new mistralai/Timestral-5M \
        --files hub:mistralai/Timestral-5M,env:timestral --why 'mejor calibrado, menos ruido'
    make models [CMD=unused]

## El registro: `registry.json`

Un uso por herramienta y modelo: `tool`, `model` (el id de Hugging Face), `files` (las claves de lo instalado que
necesita: `hub:autor/modelo`, `gguf:Nombre`, `env:carpeta`, `whisper:nombre`), `what` (para qué, en palabras),
`source` (dónde lo usa el código) y `since`. Una herramienta que empieza a usar un modelo se agrega acá **en el mismo
commit**; si no, `bin/models unused` lo ofrece para borrar.

## Las herramientas le piden su modelo al registro

Ninguna tiene la ruta escrita: la piden con `models.For(models.FindRoot(), "<herramienta>", "")` (Go, `lib/models`) o
con `bin/models path <herramienta>` (cualquier otra cosa). Cambiar el modelo de una herramienta es cambiar el registro.

| herramienta | qué pide | dónde |
|---|---|---|
| point | el GGUF de Qwen3-VL-4B y su proyector | `point/main.go` (`modelFiles`; `bin/point` le pasa `MY_TOOLS_ROOT`) |
| chat | el Whisper del dictado (`CHAT_WHISPER_MODEL` lo pisa; si el registro no contesta, el de siempre) | `chat/server/dictation.go` (`whisperModel`, con su prueba) |
| knowledge | Qwen3-Embedding-0.6B, para la búsqueda por significado (en su llama-server de :5250, `lib/llamaserve`) | `cmd/knowledge/semantic.go` |
| sentinel | el venv de Timestral-5M (un pronosticador sin registro, como Chronos-2, usa su lugar de antes) | `sentinel/server/forecast.go` (`forecasterPython`) |

`FindRoot` encuentra el registro por `MY_TOOLS_ROOT` o subiendo desde la carpeta actual y desde el ejecutable: un binario
fuera del repo (como el de `bin/point`, en `~/.cache`) necesita que su envoltorio le pase `MY_TOOLS_ROOT`.

## La regla del reemplazo

Si un modelo le gana a otro en la misma tarea (medido con la misma prueba, no por la ficha), `bin/models replace` hace
todo en un paso: el registro pasa a la herramienta al ganador, se borra lo que del perdedor ya no usa nadie y en el
historial de News (`news/favorites.json`) el perdedor queda «descartado» con el porqué y el ganador «en uso». El default
en el código de la herramienta se cambia aparte (como `-forecaster` en Sentinel). `--keep` no borra.

## Cómo está construido

| pieza | dónde |
|---|---|
| buscar lo instalado (cuatro lugares), medirlo y borrarlo sólo dentro de ellos | `lib/models/models.go` |
| el registro: leerlo, quién usa qué, reemplazar | `lib/models/registry.go` (pruebas en `models_test.go`) |
| el CLI | `cmd/models/main.go` · `bin/models` (se compila solo a `~/.cache/my-tools/models-bin`) |
| la sección «Instalados» de News, con el mismo código | `news/server/installed.go` |

Los cuatro lugares, y por qué no se mueven a uno: la caché de Hugging Face, los GGUF de llama-server
(`~/.cache/my-tools/models`), los entornos con venv (`~/.cache/my-tools/<carpeta>`) y whisper.cpp (`~/.cache/whisper`).
Cada librería busca su modelo en su lugar; moverlos rompería esas rutas sin ganar nada, porque `bin/models` ya los
encuentra y los borra desde ahí.
