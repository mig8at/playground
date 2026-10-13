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

- [x] Poder correr en local el cobro viejo de la cuota inicial (`initial-fee-payment`): con la cola de Laravel en
  `sync` (local), el trabajo que consulta el estado en Wompi (`app/Jobs/Lenders/Wompi/StatusCheck.php:75`) se vuelve a
  despachar «en 5 s», pero `sync` ignora la espera y se llama sin fin hasta agotar la pila (HTTP 500 «Maximum call stack
  size»). Termina cuando ese camino corre en local sin tocar los demás (p. ej. ese trabajo en una cola asíncrona con su
  worker, o un rodeo del arnés) y queda anotado en la skill `harness-local`.
- [ ] Que la medición de ramas por tarea (`make tareas-ramas`) detecte un revert: hoy marca «ya está en main» un
  cambio que entró y se revirtió (el auto de Refurbi, legacy-backend #1621). Termina con el caso real marcado como
  revertido. Ya hay una propuesta de sesión con el detalle.
- [ ] Que el auto-onboarding guarde los datos personales por el guardado nuevo (v2) cuando el comercio va por el
  pipeline de KYC: hoy usa el viejo y se saltaría el pipeline. Termina con el auto respetando `kyc_pipeline_allieds`,
  probado con un comercio encendido en local. Ver `knowledge/kyc-pipeline`.
- [x] Al retomar el celular del asesor después de reiniciar el panel, volver a armar el traspaso automático al
  celular del cliente («continuá en tu celular»). Hoy «Retomar» deja al asesor donde estaba pero sin ese paso.
- [ ] Confirmar con una corrida del panel en local que «Buró inyectado» gobierna la categoría: ya se le dicta el caso al mock de centrales antes de personal-info (`dictateCase`). Termina cuando «Categoría por entidad» muestra la categoría de la corrida igual a la predicha, sin la nota «el motor leyó otros datos». Depende de: Miguel — la corrida, con el mock de centrales arriba (`make harness-centrales`).

- [ ] Validar preparación, ejecución, progreso y resultado durante una corrida real.
- [ ] Migrar un llamador a la vez a las funciones de escritura seguras cuando se modifique.
- [ ] Migrar los specs de burós al lambda y conservar `source=lambda` como evidencia de participación.
- [ ] Mantener asserts, transiciones y veredicto como reglas determinísticas.
- [x] Comprobar en qa el sidebar del panel: con Refurbi elegido y canal Asesor, la línea bajo la fila dice «el asesor entra por 6e377fa6 · 3 entidades»; Celucambio, DENTIX, Smart y BCP (Perú) salen con ⚠ y ▶ apagado, con el comando `bin/pg admin test-advisor` en el tooltip. Termina cuando las dos cosas se ven así. Depende de: Miguel — la VPN de dev.
- [x] Comprobar en qa que el panel trae las excepciones del front de PostHog a la consola del celular (`✗ PostHog …`) en una corrida que falle. Termina con una excepción real en la consola. Depende de: Miguel — la VPN de dev.

## Sesiones compartidas

El harness delega las sesiones a `connectors/admin` y `connectors/advisor`. La configuración de login
vive en `connectors/.env.<ambiente>` y el único estado de navegador en `connectors/.auth/sessions/`.
Los comandos existentes se conservan. Las cachés Cognito antiguas sin identidad necesitan un primer
login desde el conector; no se atribuyen automáticamente a la cuenta configurada.

```sh
make harness-login TARGET=local
make harness-session TARGET=local
bin/pg advisor status --target local --json
```
Resultado: login abre una ventana y guarda la cuenta elegida; los chequeos muestran validez sin cookies.
El contrato y las pruebas están en [connectors](repo:playground/connectors/CLAUDE.md#L1).

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
