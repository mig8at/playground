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

- [ ] Definir con producto qué ven Superadmin comercio y Admin comercio: sólo el perfil del cliente
  (`validacion-usuario`) o también la consulta manual a Datacrédito, que dispara una consulta nueva y
  facturable al buró; termina con la respuesta en la pila.
  Depende de: producto — alcance (perfil sí/no, consulta a Experian sí/no).
- [ ] Definir con producto si el perfil se recorta a los datos del propio comercio: hoy muestra el
  historial del cliente en TODOS los comercios por los que pasó; termina con la respuesta en la pila.
  Depende de: producto — recorte por comercio.
- [ ] Conseguir la lista de comercios a habilitar y cargarla con
  `UPDATE allieds SET allow_risk_profile_view = 1 WHERE id IN (...)` en cada ambiente; termina con
  la lista en la pila.
  Depende de: Oscar — qué comercios.
- [x] Confirmar en qué repo va la migración de la columna nueva de `allieds` — en `legacy-application`,
  como `2026_06_03_120000_add_production_date_to_allieds_table`; la decisión está en la pila.
- [x] Agregar la columna `allow_risk_profile_view` (por defecto `false`) — commit 30df4c71. El
  interruptor en «Editar comercio» se quitó en 09ef13bc: Oscar quiere habilitarlo por base de datos.
- [x] Crear la regla `viewRiskProfile` (`RiskProfilePolicy`) y usarla en la ruta, en `userValidation`
  y para dibujar el ojo — commit 30df4c71, probado en local (bloque del 2026-11-03).
- [x] Abrir el PR en `legacy-application` — [#365](https://github.com/Creditop-SAS/legacy-application/pull/365), contra `develop`.
- [x] Mergear #365 en `develop` — a21fcfbc, desplegado en dev el 2026-11-03.
- [x] Correr la migración del flag en la base compartida de dev, qa y staging — 2026-11-03, batch 331, 0
  comercios habilitados (bloque en la pila). Falta en prod, al pasar a `main`.
- [x] Validar en dev con el comercio 37 habilitado y en 0 — 2026-11-03, sólo sus administradores ven a su
  cliente; el flag quedó en 0 (bloques en la pila). La pantalla de dev no se recorrió con sesión.
- [ ] Pasar a `main` con un PR `develop` → `main` y taguear; en prod, correr la migración y el
  `UPDATE` con los comercios de Oscar.
  Depende de: Oscar — aprobar el PR a `main` y la lista de comercios.
- [x] Recortar `userValidation` a clientes con solicitudes en los comercios habilitados del usuario,
  y si no, 403 sin datos — probado en local; el recorte del historial por comercio no se pudo ver
  por HTTP (ver bloque).
- [ ] Cerrar `legacy-application#171`: su contenido ya está en `main` por el merge de `develop`
  (#170); termina con el PR cerrado y una nota de por qué.
- [ ] Probar en staging con un Admin comercio del comercio 94: ve el ojo y el perfil de un cliente de
  su listado, recibe 403 con un cliente de otro comercio; termina con la medición en la pila.
  Depende de: que `staging` traiga el cambio de #170 (hoy su ruta no lleva el `can:`).

## Objetivo

Los usuarios Superadmin comercio (perfil 6) y Admin comercio (perfil 7) **de los comercios que lo
tengan habilitado** vuelven a ver, desde *Perfilamiento Usuarios*, el perfil de riesgo de los
clientes **de su comercio**, y sólo de su comercio. En los demás comercios nada cambia. Lo que cerró #170 para ellos (ver datos de buró de cualquier cédula y disparar consultas a
Experian) sigue cerrado salvo que producto decida otra cosa.

## Dónde se toca

`legacy-application`, contra `origin/main` 1755ab4f:

- `routes/admin.php` ~l. 185: `validacion-usuario` con `->middleware('can:view user validation module')`.
  ~l. 165: `centrales-de-riesgo/datacredito` (`ExperianController`).
- `app/Http/Requests/Admin/RiskCentral/ExperianRequest.php` ~l. 19: `authorize()` exige
  `view risk centrals module` (antes de #170 era `true`).
- `app/Http/Controllers/Admin/ProfilingReviewController.php` ~l. 243 `userValidation`: busca el
  usuario por cédula SIN filtro de comercio, carga `datacredito`, `agildata`, `mareigua`, `tusDatos`, y
  deja rastro en `logs` (quién consulta, qué cédula). Acá va el recorte por comercio.
- `resources/js/pages/shared/user-profiling/Index.vue` l. 102: `canViewUserValidation` sale de
  `user.allPermissionsNames` en el CLIENTE; l. 107, 247, 368: la columna «Perfil» y el ojo. Tiene que
  pasar a un booleano que mande el servidor con la regla nueva.
- `app/Http/Controllers/Admin/AlliedController.php` ~l. 197-214: los campos que guarda «Editar
  comercio» (`only([...])`); `resources/js/components/allieds/AlliedInfoEdit.vue` ~l. 384: los
  interruptores del comercio. `app/Models/Allied.php`: `$casts` y `$fillable` (también en
  `legacy-backend`, que comparte la tabla).
- `database/migrations/2026_09_17_120000_grant_user_validation_permission_to_administrator.php`: el
  molde para la migración nueva (por nombre, invalida la caché de Spatie).
- Roles por número de perfil: 6 Superadmin comercio, 7 Admin comercio
  ([admin-panel](knowledge:admin-panel)).

## Cómo se ataca

Se habilita por COMERCIO, no por rol: un interruptor en `allieds` y una regla en el servidor que lo
lee. El permiso de Spatie del rol no se toca.

1. **Columna en `allieds`** (booleana, `false` por defecto). Sin pantalla: se habilita con un
   `UPDATE` por comercio (decisión de Oscar).
2. **Regla única** (Gate o policy `viewRiskProfile(User $viewer, ?User $client)`):
   - Administrador: como hoy, con `view user validation module`.
   - Superadmin o Admin comercio: algún comercio suyo (`allied_id` o `multiple_allieds`) con el
     interruptor prendido y, si hay cliente, que tenga solicitudes en ESE comercio.
   - Cualquier otro: no.
3. **Usarla en los tres lugares**: el middleware de `validacion-usuario` (`can:viewRiskProfile`), el
   recorte dentro de `userValidation` y el booleano que dibuja el ojo, que deja de leerse de los
   permisos del cliente.
4. `view risk centrals module` (consulta manual a Experian, que se factura) queda sólo para
   Administrador, salvo que producto pida lo contrario.

Se entrega por partes: la columna con su interruptor puede ir primero (no cambia nada mientras esté
apagada), y la regla después.

## Lo que se evaluó y NO se eligió

Dar el permiso a los roles sin tocar el controlador: es una migración de una línea, pero devuelve a
483 + 251 usuarios de prod (medido el 2026-09-17) los datos de buró de cualquier cédula, que es
exactamente lo que cerró #170.

Dar `view user validation module` a los roles 6 y 7: el permiso de un rol vale para TODOS los
comercios, y no hay forma de decir «sólo en estos». Habría que filtrar igual en el código, así que el
permiso del rol no aporta nada y sí deja abierto todo lo que mire ese permiso sin el recorte (el menú,
cualquier ruta nueva).

Dar el permiso usuario por usuario (`model_has_permissions`): sirve para «algunos comercios», pero se
asigna a mano, los usuarios nuevos del comercio no lo heredan y quitarlo a un comercio es buscar
usuario por usuario. Además no recorta por comercio.

Reusar `allieds.show_profiling`: el nombre engaña, es «Priorizar orden comercio» (ordena el listado
de entidades por puntaje, `ListLenderController` ~l. 183, y muestra el porcentaje en el listado). Está
prendido en 3 de 384 comercios en prod; reusarlo cambiaría el listado de esos o ataría dos cosas
distintas al mismo interruptor.

Usar la pestaña «Perfilamiento» del detalle de solicitud (`UserRequestPolicy::viewProfiling`,
CRED-350): es otra pantalla, ligada a la aprobación manual por entidad; no es lo que se pidió.

## Lo que NO entra

- La pestaña «Perfilamiento» del detalle de solicitud (CRED-350).
- Las otras rutas de `admin.php` sin guard: siguen en `incidencias`.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Qué rol tiene cada permiso (dev/qa/staging comparten base):

```sql dev
SELECT p.name, r.name AS rol FROM permissions p
LEFT JOIN role_has_permissions rp ON rp.permission_id = p.id
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.name IN ('view user validation module', 'view risk centrals module')
```

Si alguien sigue con 403 tras migrar: caché de permisos de Spatie (`php artisan permission:cache-reset`
o reiniciar el servicio).

Prueba: admin de staging con un Admin comercio del comercio 94 → *Perfilamiento Usuarios* → ojo de un
cliente de su listado (ve el perfil) → `/validacion-usuario?document_number=<cédula de otro comercio>`
(403) → `/centrales-de-riesgo/datacredito?q=<cédula>` (403, sin consulta nueva al buró).

## Referencias

- [#170](pr:application#170) · [#171](pr:application#171) · [#365](pr:application#365)
- [admin-panel](knowledge:admin-panel)
- Comercio de ejemplo: https://admin.staging.creditop.com/aliados/94/usuarios


## Tarea (publicable)

## En una línea
En los comercios habilitados, los roles Superadmin comercio y Admin comercio pueden ver el perfil de riesgo de los clientes de su comercio desde Perfilamiento Usuarios.

## Por qué
En septiembre se restringió el perfil de riesgo del cliente sólo al administrador de CreditOp, porque cualquier usuario de comercio podía ver los datos de buró de cualquier cliente. Algunos comercios necesitan que sus administradores vuelvan a verlo para sus propios clientes, pero no todos: debe poder habilitarse comercio por comercio.

## Qué cambia
- Cada comercio tiene un indicador nuevo, apagado por defecto, que se habilita directamente en la base de datos. No hay pantalla para cambiarlo.
- En los comercios habilitados, Superadmin comercio y Admin comercio ven en Perfilamiento Usuarios la columna Perfil y el ojo, y pueden abrir el perfil de riesgo de los clientes de su comercio.
- En los demás comercios no cambia nada.

## Alcance
No pueden ver clientes de otros comercios. No se habilita para otros roles del comercio. La consulta manual a Datacrédito sigue sólo para el administrador de CreditOp.

## Dónde probar
Staging, comercio 94 habilitado y otro comercio sin habilitar, con un usuario Admin comercio y uno Superadmin comercio.

## Cómo validar
1. Habilitar el comercio 94 en la base de datos.
2. Entrar con un Admin comercio del comercio 94 y abrir Perfilamiento Usuarios: se ven la columna Perfil y el ojo.
3. Abrir el ojo de un cliente del listado: se ve su perfil de riesgo, sin el botón de consultar Datacrédito.
4. Abrir la validación de usuario con la cédula de un cliente de otro comercio: acceso denegado y la respuesta no trae datos del cliente.
5. Abrir la consulta de Datacrédito: acceso denegado.
6. Repetir con un Superadmin comercio del comercio 94.
7. Entrar con un Admin comercio del comercio sin habilitar, o con Mesa de servicio: no se ven la columna Perfil ni el ojo, y la validación de usuario responde acceso denegado.
8. Deshabilitar el comercio 94: sus administradores dejan de ver el perfil.

## Cambios en datos
Una migración que agrega el indicador a los comercios, apagado en todos. Mergear no la aplica: hay que correrla en cada ambiente. Después, habilitar en la base de datos los comercios que se indiquen.

## Criterios de aceptación
- Con el comercio habilitado, Superadmin comercio y Admin comercio ven el perfil de los clientes de su comercio.
- Con el comercio sin habilitar, no lo ven.
- Nunca ven el de clientes de otros comercios.
- La consulta manual a Datacrédito sigue cerrada para ellos.

## Dependencias / contraparte
Oscar: la lista de comercios a habilitar.
