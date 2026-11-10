---
id: 111
title: "Perfil de riesgo visible para Superadmin y Admin comercio"
ramas: feat/perfil-de-riesgo-por-comercio
stage: work
created: "2026-11-03T10:00:00-05:00"
knowledge: [admin-panel]
canon: []
jira: [CORE-925]
jira_title: "Perfil de riesgo visible para Superadmin y Admin comercio"
---

## Pendientes

- [x] Versión final: permiso `view user validation module` + recorte a los clientes del comercio, sin setting
  ni migración — 1050eddb, en [#366](https://github.com/Creditop-SAS/legacy-application/pull/366) (main) y
  [#367](https://github.com/Creditop-SAS/legacy-application/pull/367) (develop).
- [x] Mergear #367 — 6f10efbe, desplegado en dev; el recorte se validó en dev con usuarios reales (sólo lectura).
- [x] Probar en dev con el permiso dado al Admin comercio 564 del 37 — ve a su cliente, 403 con el del 53;
  permiso quitado (bloque en la pila). La pantalla de dev no se recorrió con su sesión.
- [x] ~~Mergear #366 a `main` y taguear~~ — #366 mergeado a `main` el 2026-11-10 00:27 UTC; el recorte salió en
  legacy-application v1.2.11 (PR #380 develop → main), despliegue a producción en success.
- [ ] Dar el permiso a los Admin y Superadmin comercio de los comercios que diga Oscar, en cada ambiente;
  termina con la lista en la pila. ⚠ **En un ambiente, sólo después de que el recorte esté desplegado ahí**:
  sin el recorte, el permiso deja ver el perfil de cualquier cédula. El recorte (`alliedIdsOf` en
  `ProfilingReviewController`) está en `develop` y en `main`/prod desde v1.2.11 (2026-11-09); falta en `staging`,
  y esta aplicación no tiene rama `qa`. Prod ya puede recibir el permiso.
  Depende de: Oscar — qué comercios.
- [x] Quitar de la base compartida la columna `allieds.allow_risk_profile_view` y su registro en `migrations`
  — 2026-11-03, después del despliegue de #367.
- [ ] Cerrar `legacy-application#171`: su contenido ya está en `main` por el merge de `develop`
  (#170); termina con el PR cerrado y una nota de por qué.

## Objetivo

Los Superadmin comercio y Admin comercio a los que se les dé el permiso `view user validation
module` ven, desde *Perfilamiento Usuarios*, el perfil de riesgo de los clientes **de su comercio**, y
sólo de su comercio. El Administrador sigue viendo a cualquier cliente.

## Dónde se toca

`legacy-application`, rama `feat/perfil-de-riesgo-por-comercio` (commit 1050eddb) sobre `main`:

- `app/Policies/RiskProfilePolicy.php` (nuevo): `canViewClient` (Administrador ve todo; el resto, sólo
  clientes con solicitudes en sus comercios, vía `UserRequestPolicy::alliedIdsOf`) y `seesEveryClient`.
- `app/Http/Controllers/Admin/ProfilingReviewController.php` `userValidation`: 403 antes de armar la
  respuesta, historial por comercio recortado, `is_same_allied` con `multiple_allieds`,
  `can_query_datacredito`.
- `resources/js/pages/admin/profiling-review/user-validation/Index.vue`: «Ver datacredito» sólo con
  `userData.can_query_datacredito`.
- `routes/admin.php` ~l. 180: sólo el comentario; la ruta sigue con `can:view user validation module`.
- Sin tocar, como en `main`: `shared/user-profiling/Index.vue` (el ojo lee `allPermissionsNames`),
  `UserProfilingController`, `AuthServiceProvider`, el menú (`navigation/vertical/configuration.js`:
  «Validar usuario» también se muestra con el permiso).
- Roles por número de perfil: 6 Superadmin comercio, 7 Admin comercio
  ([admin-panel](knowledge:admin-panel)).

## Cómo se ataca

1. **El permiso de siempre** en la ruta y en el ojo (`view user validation module`), como el resto del
   admin; se habilita usuario por usuario con un `INSERT` en `model_has_permissions`.
2. **Recorte en `userValidation`** (`RiskProfilePolicy::canViewClient`): quien no es Administrador sólo
   ve clientes con solicitudes en sus comercios; si no, 403 antes de armar la respuesta. El historial
   por comercio también se recorta.
3. **«Ver datacredito»** sólo con `view risk centrals module`: la consulta manual sigue siendo del
   Administrador.

## Lo que se evaluó y NO se eligió

Dar el permiso sin tocar el controlador: el usuario de comercio vería el perfil de cualquier cédula,
que es exactamente lo que cerró #170. El recorte por cliente es indispensable.

Columna `allieds.allow_risk_profile_view` con interruptor en «Editar comercio» (primera versión, #365):
se quitó el interruptor porque Oscar quería algo simple por base de datos, y luego la columna porque
`allieds` ya tiene demasiados flags.

Lista de comercios en el setting `allied_ids_with_risk_profile_view` con una regla propia
(`viewRiskProfile`) en la ruta: Oscar pidió que, si se usa un permiso, vaya igual que el resto del admin.
Con el permiso por usuario ya decidiendo quién lo ve, la lista sólo agregaba un segundo paso.

Dar `view user validation module` al ROL (6 y 7): vale para los administradores de todos los
comercios; no permite elegir comercios.

Un permiso nuevo y propio para comercios (p. ej. `view allied risk profile`), para que no les aparezca
«Validar usuario» en el menú: se propuso y no se eligió; el buscador queda protegido por el mismo recorte.

Reusar `allieds.show_profiling`: es «Priorizar orden comercio» (orden del listado de entidades).

Usar la pestaña «Perfilamiento» del detalle de solicitud (`UserRequestPolicy::viewProfiling`,
CRED-350): es otra pantalla, ligada a la aprobación manual por entidad.

## Lo que NO entra

- La pestaña «Perfilamiento» del detalle de solicitud (CRED-350).
- Las otras rutas de `admin.php` sin guard: siguen en `incidencias`.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Verificado en local y en dev (con el permiso dado y quitado al Admin comercio 564) el 2026-11-03.

**Dar el permiso** a los Admin comercio de un comercio (para incluir a los Superadmin:
`r.name IN ('Admin comercio', 'Superadmin comercio')` y
`(u.allied_id = 94 OR JSON_CONTAINS(COALESCE(u.multiple_allieds, '[]'), '94'))`):

```text
INSERT IGNORE INTO model_has_permissions (permission_id, model_type, model_id)
SELECT p.id, 'App\\Models\\User', u.id
FROM users u
JOIN model_has_roles mr ON mr.model_id = u.id AND mr.model_type = 'App\\Models\\User'
JOIN roles r ON r.id = mr.role_id
JOIN permissions p ON p.name = 'view user validation module' AND p.guard_name = 'web'
WHERE r.name = 'Admin comercio' AND u.status = 1 AND u.allied_id = 94;
```

A un solo usuario: `SELECT p.id, 'App\\Models\\User', 12345 FROM permissions p WHERE p.name = 'view user validation module' AND p.guard_name = 'web'`.

**Quitarlo**, con el mismo `WHERE` que al darlo, para que alcance a los mismos usuarios (también a quien tiene
el comercio por `multiple_allieds`). Quita el permiso también a quien ya lo tuviera antes de esta tarea: el
`SELECT` previo lo muestra. Esta forma no se corrió todavía; la que se probó en dev filtraba por
`u.allied_id = 94 AND u.user_profile_id IN (6, 7)` y dejaba afuera a los de `multiple_allieds`.

```text
DELETE mp FROM model_has_permissions mp
JOIN permissions p ON p.id = mp.permission_id AND p.name = 'view user validation module' AND p.guard_name = 'web'
JOIN users u ON u.id = mp.model_id AND mp.model_type = 'App\\Models\\User'
JOIN model_has_roles mr ON mr.model_id = u.id AND mr.model_type = 'App\\Models\\User'
JOIN roles r ON r.id = mr.role_id
WHERE r.name IN ('Admin comercio', 'Superadmin comercio')
  AND (u.allied_id = 94 OR JSON_CONTAINS(COALESCE(u.multiple_allieds, '[]'), '94'));
```

Después de dar o quitar: `php artisan permission:cache-reset`. Antes de correrlo en prod, un `SELECT`
con el mismo `WHERE` para ver a quién le cae.

**Prueba:** entrar con un Admin comercio con el permiso → *Perfilamiento Usuarios* → el ojo de un
cliente de su listado (ve el perfil, sin «Ver datacredito») → `/validacion-usuario?document_number=<cédula
de otro comercio>` (403, la respuesta sin datos) → `/centrales-de-riesgo/datacredito?q=<cédula>` (403).
Con un usuario sin el permiso: sin ojo y 403.

**En local** hay cinco usuarios de prueba (sólo en la base de Docker), anotados en los artifacts de esta
tarea. Los clientes con historial en varios comercios no se descifran con la llave de la copia
(`The MAC is invalid`), así que ese recorte no se ve en local.

## Referencias

- [#170](pr:application#170) · [#171](pr:application#171) · [#365](pr:application#365) · [#366](pr:application#366) · [#367](pr:application#367)
- [admin-panel](knowledge:admin-panel)
- Comercio de ejemplo: https://admin.staging.creditop.com/aliados/94/usuarios


## Tarea (publicable)

## En una línea
Los administradores de un comercio (Superadmin comercio y Admin comercio) a los que se les dé el permiso pueden ver el perfil de riesgo de los clientes de su comercio desde Perfilamiento Usuarios.

## Por qué
En septiembre se restringió el perfil de riesgo del cliente sólo al administrador de CreditOp, porque cualquier usuario de comercio podía ver los datos de buró de cualquier cliente. Los administradores de algunos comercios necesitan volver a verlo, pero sólo para sus propios clientes.

## Qué cambia
- Se usa el mismo permiso del módulo de validación de usuario que ya tiene el administrador de CreditOp. Se asigna por usuario a los administradores del comercio que corresponda.
- Con el permiso, ven en Perfilamiento Usuarios la columna Perfil y el ojo, y pueden abrir el perfil de riesgo sólo de los clientes que tienen solicitudes en su comercio.
- Con la cédula de un cliente de otro comercio reciben acceso denegado, y la respuesta no trae datos del cliente.
- El botón para consultar Datacrédito no se les muestra: esa consulta sigue siendo del administrador de CreditOp.
- Quien no tenga el permiso no ve ningún cambio.

## Alcance
No cambia qué solicitudes ve cada comercio, ni la consulta manual a Datacrédito. No hay pantalla para asignar el permiso: se asigna en la base de datos. No requiere migración.

## Dónde probar
Dev, con un Admin comercio y un Superadmin comercio de un comercio con clientes, y un usuario de otro comercio.

## Cómo validar
1. Asignar el permiso al Admin comercio del comercio elegido.
2. Entrar con ese usuario y abrir Perfilamiento Usuarios: se ven la columna Perfil y el ojo.
3. Abrir el ojo de un cliente del listado: se ve su perfil de riesgo, sin el botón de consultar Datacrédito.
4. Abrir la validación de usuario con la cédula de un cliente de otro comercio: acceso denegado y la respuesta no trae datos del cliente.
5. Abrir la consulta de Datacrédito: acceso denegado.
6. Entrar con un Superadmin comercio sin el permiso: no se ven la columna Perfil ni el ojo, y la validación de usuario responde acceso denegado.
7. Quitar el permiso al Admin comercio: deja de ver el perfil.
8. Con el administrador de CreditOp: todo funciona como antes.

## Criterios de aceptación
- Un administrador de comercio con el permiso ve el perfil de los clientes de su comercio.
- Nunca ve el de clientes de otros comercios.
- Sin el permiso, no ve nada nuevo.
- La consulta manual a Datacrédito sigue cerrada para ellos.
- El administrador de CreditOp no tiene cambios.

## Dependencias / contraparte
Oscar: a qué comercios se les asigna el permiso.
