---
id: 88
title: "El perfil de riesgo del cliente, sólo para el Administrador"
stage: work
ramas: fix/perfil-de-riesgo-solo-para-administradores
created: "2026-09-17T10:00:00-05:00"
context_nodes: [actors, application, kyc]
jira: []
jira_title: "Restringir el perfil de riesgo del cliente al rol Administrador"
---

## Si retomás esto sin contexto, empezá acá

**Estado al 2026-09-17: PR abierto contra `develop`, VIVO en producción hasta que mergee.**
`Creditop-SAS/legacy-application#170` — tres commits rebaseados sobre `develop`, 6 archivos, +130/-5.

Un usuario **Superadmin comercio** (rol 6) del comercio 26 abría *Perfilamiento Usuarios*, hacía clic
en el **ojo** de una fila y veía el **score de Datacrédito** del cliente, más Ágil Data, Mareigua,
TusDatos, Sistecrédito, su capacidad de endeudamiento y su historial en **todos los comercios** por los
que pasó — no sólo el suyo. Ese módulo es sólo para el Administrador.

**El próximo paso es:** que alguien revise `#170`. Ojo con el camino a producción: la rama salió de
`main` y el PR va contra `develop`, que hoy tiene **34 commits que `main` no tiene** y le faltan **7**
de `main` (82 archivos de diferencia, medido el 2026-09-17). Mergear en `develop` NO lo pone en prod:
falta el camino `develop` → … → `main`, y mientras tanto el agujero sigue abierto para los 790
usuarios.

## Cómo se atacó

La causa no era «tiene un permiso de más»: **no tiene ninguno de los dos permisos del módulo**. La
autorización del panel viejo vive en el **menú** (`resources/js/navigation/vertical/*.js`), y el menú
sólo decide qué dibujar. `routes/admin.php` declaraba `validacion-usuario` **sin `can:`**, y
`ProfilingReviewController@userValidation` recibe un `Request` pelado, sin `authorize()`.

Al módulo no se llegaba por el menú, sino por el **ojo del listado**, que se renderizaba con
`v-if="context === 'admin'"` — por **dominio**, no por permiso. Y Superadmin comercio (6) y Admin
comercio (7) son gente del comercio que **entra por el panel `admin.`**: Fortify deja pasar a todos los
roles menos Cliente y Comercial.

El único control que existía era del lado del cliente y **falla abierto justo donde importa**: el Vue
tiene un `showNotBelongsMessage` que oculta la pantalla si `user_profile_id !== 2 && is_same_allied ===
false`, pero `is_same_allied` pregunta *«¿este cliente tiene solicitudes en MI comercio?»* y **todo lo
que sale en su propio listado las tiene**. Y aunque ocultara, es un **`v-if` de template**: el servidor
mandaba el payload igual, con `$userData['datacredito']` = el reporte **descifrado entero**, que además
esquiva el `$hidden` del modelo `RiskCentralUserData`.

**Caminos evaluados y descartados:**

- **Recortar sólo el bloque de burós y dejar la pantalla** (partir el payload en el servidor según el
  permiso, y tocar el Vue). Se descartó: la pantalla es **casi toda** información de riesgo, y lo poco
  que no lo es —el historial de solicitudes— el comercio ya lo ve en su propio listado de
  perfilamiento, que sí está acotado por rol. Cerrar entero es más chico, más verificable y no deja una
  decisión de producto a medias. Decidido por Miguel el 2026-09-17.
- **Arreglar el `v-if` del front** (que el ojo mire el permiso y listo). No alcanza: el agujero es la
  ruta, y a una ruta se llega por URL. El cambio del ojo se hizo igual, pero como higiene —para que el
  botón no quede llevando a un 403—, no como el arreglo.
- **Poner el `can:` sin tocar los permisos.** Rompía: el permiso `view user validation module` **no lo
  tenía nadie**, ni el Administrador, así que el módulo quedaba cerrado para todos. Los dos cambios van
  juntos o ninguno.

> **MEDICIÓN · 2026-09-17 (prod, solo lectura).** El permiso `view user validation module` (id 55) **no
> lo tiene ningún rol** — cero filas en `role_has_permissions`—, así que su ítem de menú era invisible
> para todos mientras la ruta quedaba abierta. `view risk centrals module` (31) lo tiene sólo
> Administrador. De las **130 declaraciones de ruta de `admin.php`, sólo 16 llevaban `can:`**.

> **MEDICIÓN · 2026-09-17 (prod, solo lectura).** Usuarios activos que entran por `admin.`: **829, de
> los cuales 790 NO son Administrador** (483 Superadmin comercio, 251 Admin comercio, 17 Entidad, 16
> Contabilidad, 10 Entidad Comercio, 6 Mesa de servicio, 4 Logística, 2 Tesorería, 1 Operaciones). Los
> **4.035 Comercial no estaban expuestos**: entran por `aliados.`, donde el mismo Vue recibe
> `context: 'customer'` y el ojo no se renderiza.

> **MEDICIÓN · 2026-09-17 (base local, tras aplicar la migración).** El rol 2 pasa los dos gates; los
> roles 5, 6, 7 y 8 quedan bloqueados en ambos. La base local reproducía el estado de prod exactamente
> (permiso 55 huérfano), así que la comprobación vale.

> **RIESGO · 2026-09-17.** Segundo agujero en el mismo módulo, peor que el primero:
> `ExperianRequest::authorize()` devolvía **`true` literal**, y `/centrales-de-riesgo/datacredito` **no
> lee caché** — llama a `Experian::creditScore()`, o sea dispara una consulta **nueva y facturable** al
> buró sobre cualquier cédula, imputada al comercio «Creditop». Entra en esta misma rama. Los otros
> **nueve** Form Requests del módulo ya exigían el permiso: era una omisión aislada, no un patrón.

> **DECISIÓN · 2026-09-17.** Se agrega rastro de acceso, que no existía en ninguno de los dos
> endpoints. Va en `logs`, y **`user_id` es acá QUIEN CONSULTA** (no el sujeto, como en el resto de esa
> tabla) con la cédula consultada en `name`, para que las dos preguntas se contesten sin abrir el JSON.
> Queda comentado en los dos sitios.

> **PREGUNTA ABIERTA · 2026-09-17.** Las otras **114 rutas de `admin.php` sin guard** no se auditaron.
> Esta tarea cierra las dos que motivaron el reporte; el barrido del resto es trabajo aparte y
> probablemente más grande. Ver **F-224**.

## Registro

### 2026-09-17

**Reportado, medido y arreglado en la rama; sigue vivo en prod.** Miguel llegó con dos capturas: un
Superadmin comercio del comercio 26 entrando por el ojo de *Perfilamiento Usuarios* a la ficha de
riesgo de un cliente. La hipótesis inicial —«tiene un permiso de más»— resultó al revés: **no tiene
ninguno de los dos**, y el permiso del módulo no lo tenía **ningún** rol. La autorización del panel
vive en el menú, no en el servidor, y al ojo se llegaba por dominio.

Tres commits en `fix/perfil-de-riesgo-solo-para-administradores`, uno por concern: el `authorize()` de
Experian (que además dejaba disparar consultas facturables al buró), el cierre de `validacion-usuario`
(migración + `can:` + el ojo y su columna), y el rastro de acceso que no existía.

Verificado corriendo: `route:list -v` muestra el middleware registrado, y contra la base local —que
reproducía el estado de prod, con el permiso 55 huérfano— el rol 2 pasa los dos gates y los roles 5,
6, 7 y 8 quedan bloqueados en ambos. El lint del Vue da exactamente lo mismo que `main`. **No** se
probó el 403 con sesión real: están las dos mitades (middleware registrado + gate en `false`) y el 403
lo pone el framework.

Queda **F-224** en findings con la lección que generaliza —un permiso en `navigation/vertical/*.js` no
es un control de acceso, y a la ruta se llega por cualquier link— y la pregunta abierta de las otras
114 rutas de `admin.php` sin guard, que es trabajo aparte.

## Tarea (publicable)

## En una línea

El perfil de riesgo de un cliente —incluido su score de Datacrédito— deja de ser visible para los
usuarios de los comercios: pasa a ser exclusivo del rol Administrador, y toda consulta queda registrada.

## Por qué

Los datos de centrales de riesgo son del cliente y de CreditOp, no del comercio. Hoy cualquier usuario
con acceso al panel de administración —incluidos los perfiles Superadmin comercio y Admin comercio, que
son personal de los comercios aliados— puede abrir la ficha de riesgo completa de cualquier cliente que
aparezca en su listado, y consultar el buró sobre cualquier cédula. Ninguno de esos perfiles tiene el
permiso que ese módulo exige; el sistema simplemente no lo estaba verificando.

## Qué cambia

- La pantalla **Validación de usuario** queda restringida al rol **Administrador**.
- El botón de «Ver perfil» (el ojo) del listado de **Perfilamiento Usuarios**, y su columna, dejan de
  mostrarse a quien no tiene el permiso. El listado en sí no cambia: cada comercio sigue viendo sus
  solicitudes como hasta ahora.
- La consulta manual a **DataCrédito Experian** queda restringida al rol Administrador, igual que el
  resto del módulo de Centrales de Riesgo.
- Ambas consultas quedan **registradas**: quién consultó, qué cédula y cuándo.

## Alcance

Sólo estas dos pantallas del panel de administración. **No** cambia qué solicitudes ve cada comercio en
su listado de perfilamiento, ni el portal de aliados, ni el back-office nuevo. **No** incluye la
revisión del resto de rutas del panel sin control de permisos: eso queda como trabajo aparte.

## Dónde probar

Panel de administración (`admin.`), en el ambiente donde se despliegue. Hacen falta **dos cuentas**: una
de rol **Administrador** y otra de **Superadmin comercio** (o Admin comercio) con clientes en su
listado. La migración debe haberse aplicado.

## Cómo validar

1. Con la cuenta de **Superadmin comercio**: entrar a *Perfilamiento Usuarios*. El listado se ve igual,
   pero **no aparece la columna «Perfil» ni el ojo**.
2. Con esa misma cuenta, pegar en la barra de direcciones `/validacion-usuario?document_number=<una
   cédula de su propio listado>`. Debe responder **403**, y no debe verse ningún dato del cliente.
3. Con esa misma cuenta, entrar a `/centrales-de-riesgo/datacredito?q=<una cédula>`. Debe responder
   **403** y **no** debe quedar una consulta nueva al buró.
4. Con la cuenta de **Administrador**: repetir los tres pasos. El ojo aparece, la pantalla de validación
   abre con el score y la consulta a Experian funciona como siempre.
5. Abrir las herramientas del navegador (pestaña Red) en el paso 2 y confirmar que **la respuesta no
   trae datos del cliente** — antes el dato viajaba aunque la pantalla no lo dibujara.

## Cambios en datos

Una migración asigna el permiso `view user validation module` al rol **Administrador**. Hasta ahora ese
permiso no lo tenía ningún rol, y sin esta asignación la pantalla quedaría cerrada también para el
Administrador. Es idempotente y busca el permiso y el rol por nombre, no por id.

Para verificar que quedó aplicada:

    SELECT r.name AS rol, p.name AS permiso
    FROM role_has_permissions rhp
    JOIN roles r ON r.id = rhp.role_id
    JOIN permissions p ON p.id = rhp.permission_id
    WHERE p.name = 'view user validation module';

Debe devolver una fila: `Administrador`.

Para ver el rastro de accesos:

    SELECT created_at, user_id AS quien_consulta, name AS cedula_consultada, description
    FROM logs
    WHERE description IN ('Consulta del perfil de riesgo del cliente',
                          'Consulta manual a Experian desde el panel admin')
    ORDER BY created_at DESC;

## Criterios de aceptación

- Ningún rol que no sea Administrador puede abrir la pantalla de validación de usuario, ni por el botón
  ni escribiendo la URL.
- Ningún rol que no sea Administrador puede disparar una consulta a Experian desde el panel.
- El Administrador conserva ambos accesos, sin pasos nuevos.
- El listado de perfilamiento sigue mostrando a cada comercio exactamente las mismas solicitudes que
  antes.
- Cada consulta al perfil de riesgo y a Experian deja una fila en `logs` con el usuario y la cédula.

## Dependencias / contraparte

Ninguna externa. Si alguien de negocio necesita que un perfil de comercio siga viendo parte de esta
información, hay que definir **qué parte** antes de reabrirla: hoy se cierra entera.
