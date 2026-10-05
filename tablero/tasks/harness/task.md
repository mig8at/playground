---
id: 86
title: "Harness"
clase: proyecto
stage: work
created: "2026-09-15T17:00:00-05:00"
canon: [creditopx, arrendamiento, ecommerce, listado]
jira: []
jira_title: ""
---

## Pendientes

- [ ] Confirmar con una corrida del panel en local que «Buró inyectado» gobierna la categoría: ya se le dicta el caso al mock de centrales antes de personal-info (`dictateCase`). Termina cuando «Categoría por entidad» muestra la categoría de la corrida igual a la predicha, sin la nota «el motor leyó otros datos». Depende de: Miguel — la corrida, con el mock de centrales arriba (`make harness-centrales`).

- [ ] Validar preparación, ejecución, progreso y resultado durante una corrida real.
- [ ] Migrar un llamador a la vez a las funciones de escritura seguras cuando se modifique.
- [ ] Migrar los specs de burós al lambda y conservar `source=lambda` como evidencia de participación.
- [ ] Mantener asserts, transiciones y veredicto como reglas determinísticas.

## Cómo se comprueba — y el material

El diagnóstico combina configuración y sondas de lectura; la corrida sigue comprobando el desenlace.
Declarar sólo los mocks que necesita el caso:

```harness
make harness-environment TARGET=local LIVE=1 MOCKS=bureaus,pdf-mapper JSON=1
```
Resultado: muestra si la API se identifica, el wizard contesta y MySQL acepta `SELECT 1`, además de los
puertos de los mocks. El programa devuelve 1 ante un fallo requerido (Make informa 2); los mocks opcionales caídos no bloquean.
Un timeout conserva su incertidumbre y un HTTP 500 no se lee como servicio listo.

Las regresiones se comprueban sin login real ni datos de clientes:

```sh
cd harness && npx playwright test pkg/environment-health.spec.ts bin/preflight.spec.ts pkg/wizard-health.spec.ts pkg/sessions.spec.ts --reporter=list
```
Resultado: cubre respuestas HTTP engañosas, timeouts antes y después de las cabeceras, guardas de
hosts locales y credenciales antiguas que sólo pueden producir un aviso sin contraseña.

Para comprobar el código de salida con MySQL local real y API/wizard efímeros:

```sh
node tablero/tasks/harness/artifacts/observe-environment-health.mjs
```
Resultado: exige 0 con un mock opcional caído, 1 al exigir ese mock o recibir HTTP 500/otra API,
y 2 ante argumentos inválidos. Cierra los servidores efímeros al terminar.
El informe guardado está en `artifacts/environment-health-validation.json`.
