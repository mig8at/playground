---
id: 111
title: "Perfil de riesgo visible para Superadmin y Admin comercio"
stage: evaluation
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
- [ ] Limitar el alcance en el servidor antes de abrir el permiso: `userValidation` sólo devuelve un
  cliente con solicitudes en los comercios del usuario (`allied_id` o `multiple_allieds`), y si no,
  403; termina con el cambio en `ProfilingReviewController`.
- [ ] Dar `view user validation module` a los roles Superadmin comercio y Admin comercio con una
  migración idempotente, por nombre (como `2026_09_17_120000_grant_user_validation_permission_to_administrator`);
  termina con el PR en `legacy-application` y la migración corrida en cada ambiente.
- [ ] Cerrar `legacy-application#171`: su contenido ya está en `main` por el merge de `develop`
  (#170); termina con el PR cerrado y una nota de por qué.
- [ ] Probar en staging con un Admin comercio del comercio 94: ve el ojo y el perfil de un cliente de
  su listado, recibe 403 con un cliente de otro comercio; termina con la medición en la pila.
  Depende de: que `staging` traiga el cambio de #170 (hoy su ruta no lleva el `can:`).

## Objetivo

Los usuarios Superadmin comercio (perfil 6) y Admin comercio (perfil 7) vuelven a ver, desde
*Perfilamiento Usuarios*, el perfil de riesgo de los clientes **de su comercio**, y sólo de su
comercio. Lo que cerró #170 para ellos (ver datos de buró de cualquier cédula y disparar consultas a
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
- `resources/js/pages/shared/user-profiling/Index.vue` l. 107, 247, 368: la columna «Perfil» y el ojo
  se dibujan con `context === 'admin' && canViewUserValidation`.
- `database/migrations/2026_09_17_120000_grant_user_validation_permission_to_administrator.php`: el
  molde para la migración nueva (por nombre, invalida la caché de Spatie).
- Roles por número de perfil: 6 Superadmin comercio, 7 Admin comercio
  ([admin-panel](knowledge:admin-panel)).

## Cómo se ataca

1. Recorte por comercio en `userValidation` (y en lo que devuelva el payload): sin esto, abrir el
   permiso repite el agujero de septiembre.
2. Migración que da `view user validation module` a los roles 6 y 7.
3. `view risk centrals module` (consulta manual a Experian) queda sólo para Administrador, salvo que
   producto pida lo contrario.

## Lo que se evaluó y NO se eligió

Dar el permiso a los roles sin tocar el controlador: es una migración de una línea, pero devuelve a
483 + 251 usuarios de prod (medido el 2026-09-17) los datos de buró de cualquier cédula, que es
exactamente lo que cerró #170.

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

- [#170](pr:application#170) · [#171](pr:application#171)
- [admin-panel](knowledge:admin-panel)
- Comercio de ejemplo: https://admin.staging.creditop.com/aliados/94/usuarios


## Tarea (publicable)

## En una línea
Los roles Superadmin comercio y Admin comercio pueden ver el perfil de riesgo de los clientes de su comercio desde Perfilamiento Usuarios.

## Por qué
En septiembre se restringió el perfil de riesgo del cliente sólo al administrador de CreditOp, porque cualquier usuario de comercio podía ver los datos de buró de cualquier cliente. Los administradores del comercio necesitan volver a verlo para sus propios clientes.

## Qué cambia
En Perfilamiento Usuarios, Superadmin comercio y Admin comercio vuelven a ver la columna Perfil y el ojo, y pueden abrir el perfil de riesgo de los clientes de su comercio.

## Alcance
No pueden ver clientes de otros comercios. La consulta manual a Datacrédito sigue sólo para el administrador de CreditOp, salvo que producto decida lo contrario.

## Dónde probar
Staging, comercio 94, con un usuario Admin comercio y uno Superadmin comercio.

## Cómo validar
1. Entrar con un Admin comercio del comercio 94 y abrir Perfilamiento Usuarios: se ven la columna Perfil y el ojo.
2. Abrir el ojo de un cliente del listado: se ve su perfil de riesgo.
3. Abrir la validación de usuario con la cédula de un cliente de otro comercio: acceso denegado y la respuesta no trae datos del cliente.
4. Abrir la consulta de Datacrédito: acceso denegado y ninguna consulta nueva al buró.
5. Repetir con un Superadmin comercio.

## Cambios en datos
Una migración que da el permiso del módulo de validación de usuario a los dos roles. Mergear no la aplica: hay que correrla en cada ambiente.

## Criterios de aceptación
- Superadmin comercio y Admin comercio ven el perfil de los clientes de su comercio.
- No ven el de clientes de otros comercios.
- La consulta manual a Datacrédito sigue cerrada para ellos.

## Dependencias / contraparte
Producto: confirmar si el perfil muestra el historial del cliente en otros comercios y si estos roles deben poder consultar Datacrédito.
