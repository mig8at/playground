---
id: 95
title: "Ecommerce: pruebas en conjunto de todo el flujo"
stage: work
created: "2026-09-23T17:30:00-05:00"
canon: []
jira: [CORE-543]
jira_title: "Ecommerce: pruebas en conjunto de todo el flujo"
ramas: feat/ecommerce-checkout-por-settings
---

## Si retomás esto sin contexto, empezá acá

**Qué se busca:** probar el canal ecommerce de punta a punta, con lo que cada uno hizo por su lado, y
poder elegir **comercio por comercio** si el checkout de la tienda entra al wizard nuevo o sigue en el
monolito. Es la continuación de CORE-30 (tarea `ecommerce-stateless`), que llega hasta el listado,
el webhook y el retorno.

**Estado real (23/9):** el checkout del monolito (`legacy-application#169`, en `develop`) rebota al
wizard a **todo** el que no es Corbeta. `legacy-application#201` (abierto contra `develop`) lo condiciona
a las dos filas de `settings` que ya decidían el flujo de asesor. QA arma las URLs de prueba con la
página [Contrato de checkout](https://claude.ai/artifact/3SeV7vVMBN2DFqMeVueGAb): 26 comercios con su
sucursal de QA, entrada por `aliados` u `originaciones`, y el destino de cada comercio según `settings`.

**Ya comprobado:** el destino del rebote NO lo decide el código sino `NEW_FRONTEND_BASE_URL` del
servicio del monolito en dev, y hoy apunta a `originaciones.dev` (el wizard de `develop`), no a QA.
La página del artefacto no puede recibir el webhook ni leer el retorno: para eso queda webhook.site.

## Pendientes

- [ ] **Mergear `legacy-application#201` a `develop`**; termina cuando el checkout de un comercio no
      habilitado en `settings` se quede en `aliados` en dev.
- [ ] **Habilitar en QA las sucursales ecommerce que se van a probar por el wizard** (hash en
      `new_frontend_allied_branches`); termina cuando su rebote aparezca en la sonda de abajo.
      Depende de: #201 desplegado. Hoy ninguna sucursal ecommerce está habilitada.
- [ ] **Decidir a qué wizard rebota `aliados.dev`**: cambiar `NEW_FRONTEND_BASE_URL` del secreto
      `dev/legacy-application` (arrastra los otros seis flujos del monolito) o darle al checkout una
      variable propia. Termina cuando la sonda devuelva `originaciones-qa`.
- [ ] **Unificar la lista de Corbeta**: el código de #169 tiene `[24, 209, 210, 211, 311]` y
      `settings.corbeta_allieds` dice `[209, 210, 211]` (y la fila está duplicada, ids 21 y 26).
- [ ] **Leer `new_frontend_allied_branches` y `new_frontend_allieds` en producción** antes de llevar
      #201 a `main` (pide la VPN de prod).
- [ ] Cuando se despliegue #201, actualizar el artefacto si cambian los valores de `settings` (están
      fijos en la página, leídos el 23/9).

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

## Lo que está decidido

> **DECISIÓN · 2026-09-23** — el checkout usa las MISMAS dos filas de `settings` que el flujo de asesor,
> no una nueva: la regla ya existía copiada en dos controladores y pasa a un solo método.

> **DECISIÓN · 2026-09-23** — Corbeta no se toca: sigue saliendo por su camino antes de mirar `settings`.

> **DECISIÓN · 2026-09-23** — para ecommerce conviene habilitar por **hash de sucursal**: el comercio
> entero en `new_frontend_allieds` mueve también el flujo de asesor de sus sucursales físicas.

## Riesgos

> **RIESGO · 2026-09-23** — al desplegar #201 en `develop`, el checkout de todos los comercios que no
> son Corbeta vuelve al monolito hasta que se agregue su hash: la entrada por `aliados` deja de rebotar.

> **RIESGO · 2026-09-23** — Creditop (`24`) está en `true` en `new_frontend_allieds` en dev, pero es de
> Corbeta en el código: la página de QA lo muestra «→ originaciones» y en realidad sale por Corbeta.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

**A dónde rebota `aliados`**, sin crear nada (el rebote ocurre antes de leer el contrato):

```sh
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://aliados.dev.creditop.com/checkout/13874eb6?o=x&p=x&t=x&u=x&ps=x&config=x"
```

> **MEDICIÓN · 2026-09-23** — `302 https://originaciones.dev.creditop.com/ecommerce/13874eb6/checkout?…`:
> rebota al wizard de `develop`, no a QA.

**Qué dice `settings`** (base de dev/QA; sólo estas dos claves: la tabla guarda credenciales):

```sql
SELECT `key`, value, updated_at FROM settings
WHERE `key` IN ('new_frontend_allied_branches','new_frontend_allieds')
```

> **MEDICIÓN · 2026-09-23** — 17 hashes (uno repetido), ninguno de ecommerce; `{"24": true, "26": true}`.

**La regla**, sin base: `php vendor/bin/phpunit tests/Unit/NewFrontendUrlServiceAllowsTest.php
tests/Unit/NewFrontendUrlServiceEcommerceCheckoutTest.php` desde `legacy-application` → 13/13.

**Las URLs de prueba**: [Contrato de checkout](https://claude.ai/artifact/3SeV7vVMBN2DFqMeVueGAb). El
webhook y el retorno se miran en webhook.site (la bandeja viene puesta).

## Referencias

- [legacy-application#201](https://github.com/Creditop-SAS/legacy-application/pull/201) — el checkout decide por `settings`.
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
