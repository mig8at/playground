# Roles de usuario: quién es quién y qué alcance tiene

El rol de un usuario es su **perfil** (`users.user_profile_id`), el mismo número que su rol de Spatie.
Este tema ordena los trece perfiles por familia y explica las tres formas en que el código decide qué
puede hacer cada uno. Describe `legacy-application` y `legacy-backend` en las refs de `sources.json`.
Las secciones del admin y sus escrituras sin permiso están en [el admin](knowledge:admin-panel). Qué
permiso tiene cada rol en una base concreta se lee en esa base: el código no lo fija.

## Cuatro familias de perfiles

| familia | perfiles | dónde trabaja |
|---|---|---|
| **Cliente** | 1 Cliente | el asistente y la app; no entra al admin |
| **Comercio** | 4 Comercial (el **asesor**), 6 Superadmin comercio, 7 Admin comercio | el asesor, en el asistente; los admin de comercio, en el admin |
| **Entidad** | 5 Entidad, 13 Entidad Comercio (atado a una entidad por `users.lender_id`) | el admin |
| **Creditop** | 2 Administrador, 3 Operaciones, 8 Mesa de servicio, 9 Tesorería, 10 Contabilidad, 11 Analista, 12 Logística | el admin |

Al admin de `legacy-application` entran todos menos Cliente y Comercial
(`FortifyServiceProvider::shouldAuth`). El 13 está como constante en `UserProfile`; los demás salen
del orden en que se crearon los roles.

## Tres formas de decidir qué puede hacer cada uno

1. **Permisos de Spatie por rol** (`role_has_permissions`): habilitan módulos y acciones del admin
   («ver solicitudes», «actualizar solicitud», «ver reportes»…). La mayoría se carga en la base; algunos
   permisos recientes los crea o asigna una migración de application.
2. **Permisos por usuario** (`model_has_permissions`): se dan uno a uno. Al crear un usuario de
   comercio asesor (4) o superadmin (6), si el comercio tiene una entidad CreditopX, el alta le da los
   permisos de los créditos CreditopX (`AlliedCorporateUserController::store`), incluido
   `reduce creditop x installments` (bajar el valor de las próximas cuotas). Al perfil Entidad
   Comercio (13) el alta le da ese mismo permiso, salvo que el usuario sea de un comercio que trabaja
   con SmartPay (`CreditopXPrincipalPaymentType::isSmartPayUser`). Por eso dos usuarios del mismo
   perfil pueden ver cosas distintas.
3. **Comparaciones con el número de perfil en el código** (`user_profile_id == 4`, `== 7`…). Deciden
   comportamiento sin pasar por permisos, y son muchas: la mayoría son del asesor (4). Un perfil nuevo
   o renumerado no hereda estas ramas.

## El alcance de cada perfil del comercio

Lo que ve cada perfil del comercio no lo dice un permiso: lo recorta cada controlador con columnas del
usuario. Los recortes que se repiten son:

- **Asesor (4)**: una sucursal, `users.allied_branch_id`, que es obligatoria al editarlo. El listado de
  entidades y el historial de créditos del comercio salen de esa sucursal, salvo que el asesor haya
  elegido otra (queda en caché por usuario). En las solicitudes, los estados por los que puede filtrar
  salen de `status_per_profiles` para su perfil, y sólo a él se le calculan las estadísticas generales.
- **Admin comercio (7)**: un comercio, `users.allied_id`, con varias sucursales
  (`multiple_allied_branches`, obligatoria al editarlo).
- **Superadmin comercio (6)**, y también Mesa de servicio, Tesorería y Contabilidad (8, 9 y 10) en los
  reportes: varios comercios, `users.multiple_allieds`.
- **Entidad Comercio (13)**: una entidad, `users.lender_id`.

Como el recorte vive en cada controlador, no es parejo: hay listados que no recortan por rol y lecturas
por id que no miran el comercio ([el admin](knowledge:admin-panel#listados-que-no-se-recortan-por-rol)).
