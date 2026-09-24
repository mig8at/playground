---
id: 95
title: "Ecommerce: pruebas en conjunto de todo el flujo"
stage: work
created: "2026-09-23T17:30:00-05:00"
canon: []
jira: [CORE-543]
jira_title: "Ecommerce: pruebas en conjunto de todo el flujo"
ramas: feat/ecommerce-checkout-por-settings, fix/restaurar-ecommerce-en-qa
---

## Pendientes

- [ ] **Mergear `frontend-monorepo#1051` a `qa` y redesplegar el front de QA**; termina cuando
      `https://originaciones-qa.dev.creditop.com/ecommerce/13874eb6/checkout` deje de dar 404.
      Repone lo que el merge de #1048 revirtió en `qa`.
- [ ] **Preguntarle a Santi si su front de Credito365 quedó sin pushear**: #1048 no trae ningún cambio
      de Credito365. Termina con su respuesta.
- [ ] **Correr el flujo de punta a punta en QA con Pullman** (entrada `aliados`) una vez desplegado
      #1051; termina cuando la compra llegue al listado y el veredicto a la bandeja de webhook.site.
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
