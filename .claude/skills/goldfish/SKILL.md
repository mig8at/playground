---
name: goldfish
description: El paso previo a publicar un PR en un repo real (legacy-backend, frontend-monorepo, legacy-application…): pasar la rama por Goldfish (Elephant-Goldfish) con `make goldfish-check`. Usala cuando la rama esté lista y antes de `gh pr create` o de pedirle a Miguel que lo abra; también cuando Miguel diga «pasalo por goldfish», «validalo antes de publicar» o pegue un PR de otro para revisar (`make goldfish-run PR=<url>`).
---

# goldfish · el paso previo a publicar

Quien escribió el cambio (vos, la sesión: sos el **elephant**) no lo valida solo. Goldfish lo pone delante de dos
revisores en frío que sólo ven la descripción, el diff y lo que pide la tarea, y después un elephant con el contexto
del playground le da veredicto a cada hallazgo contra el código. El método y sus trampas: `goldfish/CLAUDE.md`.

## El flujo

1. **Escribí la descripción del PR que vas a abrir** en un Markdown (en el scratchpad): la primera línea es el
   título; después, qué cambia y por qué, qué se tocó (rutas del repo) y cómo se comprobó (qué se midió y qué dio).
   Con las reglas de siempre: **sin nombrar herramientas internas** (harness, tablero, playground, `make`…).
2. **Corré el chequeo** sobre la rama (la que tenga el clon si no decís otra), contra la base donde va el PR:

       make goldfish-check REPO=legacy-backend DESC=<ruta al md> BASE=main
       make goldfish-check REPO=frontend-monorepo RAMA=fix/x DESC=<md> BASE=qa PROBAR=1

   `PROBAR=1` además lo comprueba corriendo con el harness en LOCAL: el clon se pone en ese commit (si ya está ahí no
   se mueve) y vuelve solo a su rama. Usalo cuando el cambio se pueda ejercitar en local; tarda más y gasta más.
   Corre unos minutos (3 agentes con `claude -p`, ~US$1–4 equivalentes del asiento): lanzalo en segundo plano.
3. **Leé el resumen** (stdout) y decidí con criterio, **sin ser estricto**:
   - «Para atender antes de publicar»: lo confirmado de ESTE cambio. Arreglalo, o corregí la descripción si el
     problema es que dice algo que el diff no hace.
   - «Para mirar»: depende de algo que no se ve leyendo. Decíselo a Miguel en una línea; no frena el PR.
   - «Fuera de alcance»: puede ser cierto, pero no es de esta tarea. **No lo arregles**: a lo sumo, una línea en el
     cierre por si vale una tarea aparte.
   - Si el resumen dice «Nada para atender», se puede publicar.
4. Si corregiste algo, no hace falta repetir el chequeo entero por un detalle; sí si el cambio fue grande.
5. **Publicar sigue siendo decisión de Miguel**: en los repos reales no se abre PR ni se pushea sin su permiso.

## Lo que no hace

- No comenta en GitHub, no aprueba, no pushea ni abre el PR.
- No reemplaza las pruebas de la tarea ni el criterio de Miguel: es una segunda mirada, en frío.
- El informe completo queda en `goldfish/.runs/<id>/report.md` y, si la rama es de una tarea, en sus `artifacts/`
  con un bloque en su pila.
