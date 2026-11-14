---
id: 108
title: "Sucursal ecommerce de prueba y token de payment-link desde el admin"
stage: work
created: "2026-10-29T12:00:00-05:00"
ramas: feat/sucursal-ecommerce-de-prueba, legacy-application:editar-sucursal-ecommerce, legacy-application:laravel-12-cve-develop
knowledge: [merchant-onboarding, ecommerce-context]
canon: []
jira: [CORE-913]
jira_title: "Sucursal ecommerce de prueba y token de payment-link desde el admin"
---

## Pendientes

- [x] ~~Crear el issue en Jira~~ — [CORE-913](jira:CORE-913), sprint activo, en progreso (2026-10-29).
- [ ] Emitir el token de payment-link desde el admin de legacy-application: al crear una credencial de ecommerce, y con
      «Emitir token nuevo» / «Revocar» en la pestaña de ecommerce; el token se muestra una sola vez. Termina con un token
      emitido desde el admin local que autentica contra `POST /api/ecommerce/payment-link` de legacy-backend local (422 con
      cuerpo vacío, 401 con uno inventado).
- [ ] Al crear un comercio, crear también la sucursal ecommerce de prueba `e<hash>-fake`, con credencial, las entidades del
      comercio y su token, junto a la física `p<hash>-fake` del asesor (tarea #98; los comercios anteriores la
      conservan como `b<hash>-fake`). Ya está en `develop` de legacy-application (8ebe12f5) y lo describe
      `knowledge/merchant-onboarding`. Termina con un comercio nuevo en local que
      trae las dos sucursales y una compra por payment-link con la `e…-fake`.
- [ ] Agregar `allied_branches.is_test` con una migración de legacy-backend (es el dueño del esquema, como en CRED-367) y
      marcar las dos sucursales de prueba; la app la escribe sólo si la columna existe (`Schema::hasColumn`).
      Termina con la columna en local y las dos sucursales con `is_test = 1`.
- [x] ~~Revisar y mergear [legacy-application#345](pr:legacy-application#345) y [legacy-backend#1806](pr:legacy-backend#1806)~~ —
      los dos mergeados el 2026-10-29.
- [ ] Correr la migración de `is_test` en la base compartida de dev, qa y staging: la columna
      `allied_branches.is_test` sigue sin existir ahí (medido el 2026-11-09), aunque en prod ya corrió (batch 242,
      30 sucursales marcadas). Termina con la columna y un comercio nuevo de dev/qa con sus dos sucursales de prueba
      marcadas.
- [x] ~~Mergear [legacy-application#348](pr:legacy-application#348) a `develop`~~ — mergeado y desplegado en dev el 2026-10-29 (20:19 UTC).
- [x] ~~Llevar #345 y #348 a producción~~ — entraron a `main` por develop → main y están en prod desde
      legacy-application v1.2.10 (2026-11-04; siguen en v1.2.11); la parte de legacy-backend (#1806) está en prod
      desde v0.6.45 o antes, y la migración de `is_test` corrió en prod (batch 242).
- [ ] Cerrar [legacy-application#349](pr:legacy-application#349): sus 10 commits ya están en `main` por equivalencia de
      parche (medido con `git cherry` el 2026-11-09). Termina con el PR cerrado y una nota de por qué.
- [ ] En el admin de prod, emitir el token versión 5 de la sucursal de prueba de Creditop para la prueba VTEX de la
      tarea #102. Termina con el token emitido y guardado donde la prueba lo lee.
## Objetivo

Que probar un comercio por tienda no dependa de nadie con acceso al contenedor:

- el token de payment-link (Sanctum de la sucursal, ability `ecommerce`) se emite y se revoca desde el admin, y se ve
  una sola vez;
- cada comercio nuevo trae, además de la sucursal y el asesor de prueba, una sucursal ecommerce de prueba lista para
  conectar una tienda (VTEX, Shopify, Woo, payment-link).

## Dónde se toca

`legacy-application` (`main`):

- `app/Models/AlliedBranch.php` — el trait `HasApiTokens` de Sanctum: el token queda con `tokenable_type =
  App\Models\AlliedBranch`, el mismo nombre de clase que lee legacy-backend (`EnsureEcommerceToken`).
- `app/Http/Controllers/Admin/AlliedEcommerceCredentialsController.php` — `store` crea la sucursal `Ecommerce-…`; ahí se
  emite el token. Hoy deduce la plataforma sin Shopify (`Vtex` → 3, con secret → 1, si no 2).
- `app/Services/Allied/TestAdvisorProvisioner.php` — crea `b<hash>-fake` y el asesor; la sucursal ecommerce de prueba va
  al lado, sin romper el alta si falla.

`legacy-backend` (`main`): la migración de `allied_branches.is_test`.

## Cómo se ataca

1. Un servicio en legacy-application que emite (`createToken('ecommerce-payment-link', ['ecommerce'])`), revoca y resume
   (emitido, último uso) los tokens de una sucursal, el mismo formato que `ecommerce:issue-token` de legacy-backend.
2. La pestaña de ecommerce lo usa; el token viaja en el flash una vez.
3. El provisionador crea la sucursal ecommerce de prueba del mismo hash **base** que la física, pero con hash
   propio `e<hash>`: legacy-backend resuelve la sucursal por hash con `->first()`, y con el mismo hash una compra
   por la tienda podría caer en la física (`knowledge/merchant-onboarding`).

## Lo que se evaluó y NO se eligió

- **Una sola sucursal de prueba para asesor y tienda.** En legacy-backend una solicitud es ecommerce si su SUCURSAL tiene
  credencial (`IsEcommerceBranchService`, `UserRequestService::findOrCreateUserRequest`, `CommerceService`): el canal
  asesor se comportaría distinto que en un comercio real.
- **Una columna «es ecommerce» en la sucursal.** Sería una segunda verdad de lo que ya dice la credencial, y el código
  seguiría preguntando por la credencial en ~10 lugares; se muestra derivado.
- **Emitir el token desde legacy-backend por API.** No hace falta: legacy-application comparte la base y tiene Sanctum 4.

## Lo que NO entra

- Reemplazar la credencial vieja (`credential` = `bin2hex(id + hash + fecha)`, derivable): es la de la 4.x.
- La plataforma Shopify en el alta de application.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

En local: crear un comercio desde el admin, ver las dos sucursales, copiar el token del diálogo y probarlo:

```sh
curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost/api/ecommerce/payment-link -H "Authorization: Bearer <token>" -H 'Accept: application/json' -d '{}'
```

## Referencias

- Tarea #98 (sucursal y asesor de prueba) y su pendiente «que la prueba de un comercio cubra también ecommerce».
- Tarea #102 (integración VTEX): el token 18 de qa se creó a mano en la base porque no había cómo emitirlo sin el
  contenedor.

## Tarea (publicable)

## En una línea

El admin emite el token de payment-link de una sucursal ecommerce y cada comercio nuevo trae una sucursal ecommerce de
prueba lista para conectar una tienda.

## Por qué

Hoy el token que piden las tiendas para generar el enlace de pago sólo se emite por consola dentro del servidor, y el
admin muestra en su lugar una credencial vieja que ya no sirve. Probar un comercio por tienda depende de alguien con
acceso al servidor.

## Qué cambia

- En la pestaña de ecommerce del comercio: «Emitir token nuevo» y «Revocar»; el token se muestra una sola vez.
- Al crear un comercio: además de la sucursal y el asesor de prueba, una sucursal ecommerce de prueba con sus entidades
  y su token.

## Dónde probar

Dev (admin y wizard de dev), con un comercio nuevo.

## Criterios de aceptación

- El token emitido desde el admin genera un enlace de pago; uno revocado deja de funcionar.
- Un comercio nuevo trae dos sucursales de prueba y la de ecommerce recibe una compra de una tienda.
