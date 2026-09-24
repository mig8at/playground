---
id: 95
title: "Ecommerce: pruebas en conjunto de todo el flujo"
stage: work
created: "2026-09-23T17:30:00-05:00"
canon: []
jira: [CORE-543]
jira_title: "Ecommerce: pruebas en conjunto de todo el flujo"
ramas: feat/ecommerce-checkout-por-settings, fix/restaurar-ecommerce-en-qa, fix/profiling-reviews-user-id-bigint, fix/ecommerce-amount-from-order
---

## Pendientes

- [x] ~~Declararle el área a la sección de canon del monto avisado~~ — `Creditop-SAS/playground#284`
      mergeado y desplegado; revisión 10: área 6 de `cuota/context` con 7 archivos y 3 tablas, y la
      sección enlazada además al área que ya declaraba `PaymentCalculationService.php`.
- [ ] **Preguntarle a producto si el aviso al comercio tiene que llevar el total del pedido** y no el
      monto financiado. Con cuota inicial el sistema viejo avisa MENOS que la orden; con costos
      administrativos el nuevo avisa MÁS (en QA: pedido de 2.000.000, aviso de 2.140.000). Pesa más en
      VTEX, que recibe ese monto en `value`. Termina con la decisión. Depende de: producto.
- [x] ~~Publicar en canon la sección del monto que se le avisa al comercio~~ — publicada en
      `cuota/context#al-comercio-se-le-avisa-lo-financiado-no-el-total-de-su-pedido` (revisión 9),
      por el recurso directo y todavía sin su área: el borrador no podía cerrar (sin id estable).
- [x] ~~Medir en producción cuántas compras de tienda recibieron un monto distinto del pedido~~ —
      90 días, 725 autorizadas y avisadas: `final_amount` ≠ total en 135 (129 por debajo, con cuota
      inicial); `final_amount + cuota inicial` ≠ total en 30 (28 por encima, 24 con costos
      administrativos).
- [ ] **Comprobar el retorno a la tienda**: el `GET` de «Regresar al comercio» sólo sale clickeando en
      el navegador; termina cuando una compra hecha desde el artefacto lo deje en la bandeja.
- [ ] **Preguntarle a Santi si su front de Credito365 quedó sin pushear**: #1048 no trae ningún cambio
      de Credito365. Termina con su respuesta.
- [x] ~~Mergear `frontend-monorepo#1051` a `qa` y redesplegar~~ — mergeado y desplegado; la flota
      terminó de rotar a las 00:27 UTC (el checkout pasó de 404 a responder).
- [x] ~~Correr el flujo de punta a punta en QA con Pullman~~ — uReq 502705 en estado 11 con
      CrediPullman, y el veredicto llegó a webhook.site (`POST`, `status: completed`,
      `transactionId 7482_502705`).
- [ ] **Actualizar el artefacto**: el destino medido del rebote sigue diciendo `originaciones.qa`;
      hoy es `originaciones-qa.dev` (medido 19:13).
- [x] ~~Mergear `legacy-application#201` a `develop`~~ — mergeado y desplegado: AHL (no habilitado)
      se queda en el checkout viejo (`412` con el contrato falso de la sonda).
- [x] ~~Habilitar a Pullman~~ — el comercio entero (`"94": true` en `new_frontend_allieds`, 23/9 16:11):
      sus 112 sucursales, incluido el flujo de asesor de las 109 físicas.
- [x] ~~Decidir a qué wizard rebota `aliados.dev`~~ — Oscar corrigió `NEW_FRONTEND_BASE_URL`, que
      había quedado mal escrita (`originaciones.qa.creditop.com`, sin DNS), y redesplegó: rebota a
      `originaciones-qa.dev.creditop.com`.
- [ ] **Unificar la lista de Corbeta**: el código de #169 tiene `[24, 209, 210, 211, 311]` y
      `settings.corbeta_allieds` dice `[209, 210, 211]` (y la fila está duplicada, ids 21 y 26).
- [ ] **Leer `new_frontend_allied_branches` y `new_frontend_allieds` en producción** antes de llevar
      #201 a `main` (pide la VPN de prod).

## Objetivo

Que QA pueda recorrer el flujo ecommerce entero —checkout, datos, listado, cierre, webhook y retorno—
en el comercio que elija, y que qué comercios entran al wizard nuevo sea **configuración**, no código.

## Dónde se toca

**`legacy-application`** (el monolito):
- `app/Services/NewFrontendUrlService.php` — `isEnabledFor()` y la regla pura `allows()` (#201).
- `app/Http/Controllers/Customer/WoocommerceController.php` — `show()`: Corbeta primero (sin cambios),
  después el rebote al wizard sólo si `isEnabledFor()`.
- `app/Http/Controllers/Customer/SimulatorController.php` (`indexV2`) y
  `UserRequestController.php` (`validateTempUsers`) — la misma regla, antes copiada en los dos.
- `tests/Unit/NewFrontendUrlServiceAllowsTest.php` — 7 pruebas de la regla.

**`legacy-backend`**: el veredicto al comercio lo postean los notificadores de
`Modules/Onboarding/App/Services/Ecommerce/` (`SelfDevelopmentNotifier`, `WooCommerceNotifier` le pega
el número de pedido a la URL, `VtexNotifier`).

**`frontend-monorepo`**: el retorno a la tienda es sólo el botón «Regresar al comercio» de
`apps/loan-request-wizard/app/routes/loan-approved.tsx`, sin parámetros; en un rechazo no hay retorno.

**Base (`settings`)**, filas con `value` JSON:

| `key` | forma | habilita |
|---|---|---|
| `new_frontend_allied_branches` | `{"hashes": [...]}` | sucursales, por hash |
| `new_frontend_allieds` | `{"<allied_id>": true}` | todas las sucursales de un comercio |

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

**A dónde rebota `aliados`**, sin crear nada (el rebote ocurre antes de leer el contrato):

```sh
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://aliados.dev.creditop.com/checkout/13874eb6?o=x&p=x&t=x&u=x&ps=x&config=x"
```

**Qué dice `settings`** (base de dev/QA; sólo estas dos claves: la tabla guarda credenciales):

```sql
SELECT `key`, value, updated_at FROM settings
WHERE `key` IN ('new_frontend_allied_branches','new_frontend_allieds')
```

**La regla**, sin base: `php vendor/bin/phpunit tests/Unit/NewFrontendUrlServiceAllowsTest.php
tests/Unit/NewFrontendUrlServiceEcommerceCheckoutTest.php` desde `legacy-application` → 13/13.

**Las URLs de prueba**: [Contrato de checkout](https://claude.ai/artifact/3SeV7vVMBN2DFqMeVueGAb). El
webhook y el retorno se miran en webhook.site (la bandeja viene puesta).

## Referencias

- [legacy-application#201](https://github.com/Creditop-SAS/legacy-application/pull/201) — el checkout decide por `settings`.
- [frontend-monorepo#1051](https://github.com/Creditop-SAS/frontend-monorepo/pull/1051) — repone en `qa` lo que revirtió el merge de #1048.
- Tarea `ecommerce-stateless` (CORE-30) — lo que llega hasta el listado, el webhook y el retorno.
- [Diseño del flujo ecommerce en Figma](https://www.figma.com/design/SsvFsK5tLvR1jNT3Hh6znD/flujo-ecommerce?node-id=334-455&m=dev) — la sección `ecommerce` (64 pantallas); también en artifacts. Se lee por consola con `bin/pg figma node '<url>' --depth 1`, y una pantalla con `--id <id> --depth 8 --text`.

## Tarea (publicable)

## En una línea
Probar en conjunto el flujo de compra en tienda de punta a punta, y poder activar el flujo nuevo comercio por comercio.

## Por qué
Hoy, cuando una tienda manda a su comprador a CreditOp, todos los comercios (salvo Corbeta) pasan al flujo nuevo a la vez. No se puede probar ni activar de a un comercio, y el destino en el ambiente de pruebas no es el de QA.

## Qué cambia
- El checkout de la tienda pasa al flujo nuevo sólo para las sucursales o comercios habilitados en la configuración. Los demás siguen con el checkout de siempre.
- Corbeta sigue exactamente igual.
- QA tiene una página que arma la URL de compra de 26 comercios de prueba y dice por dónde va a entrar cada uno.

## Alcance
- No cambia el camino de Corbeta.
- No cambia todavía a qué ambiente del flujo nuevo rebota el ambiente de pruebas: queda como pendiente.

## Dónde probar
Ambiente QA. Página de URLs de prueba: https://claude.ai/artifact/3SeV7vVMBN2DFqMeVueGAb. El veredicto y el retorno se ven en la bandeja de webhook.site que trae la página.

## Cómo validar
1. En la página, elegir un comercio y la entrada «aliados», y armar la URL.
2. Con el comercio NO habilitado: la compra se queda en el checkout de siempre.
3. Habilitar la sucursal en la configuración y repetir con un comprador nuevo: la compra rebota al flujo nuevo con los datos del pedido.
4. Con un comercio de Corbeta: el camino no cambia, esté o no habilitado.
5. Cerrar una compra aprobada: en la bandeja llega el veredicto (POST) y, al tocar «Regresar al comercio», la vuelta (GET).

## Criterios de aceptación
- Sólo los comercios o sucursales habilitados entran al flujo nuevo.
- Los no habilitados y Corbeta se comportan igual que antes.
- Una configuración ausente o mal escrita no habilita a nadie.

## Cambios en datos
Para que una tienda entre al flujo nuevo hay que agregar su sucursal a la configuración del flujo nuevo, en cada ambiente. Hoy en QA no hay ninguna sucursal de tienda habilitada.

## Dependencias / contraparte
- Revisión y merge del cambio en el monolito.
- Infraestructura: a qué ambiente del flujo nuevo rebota el ambiente de pruebas.
