# Perfilamiento del cliente: probabilidades, pantallas y aprobación manual

«Perfilamiento» se usa para dos cosas que no tienen relación: el **perfil del usuario** es su rol
([roles de usuario](knowledge:user-roles)); el **perfilamiento** es el perfil de riesgo de un cliente
para una solicitud. Este tema cubre lo segundo: cómo se calcula la probabilidad de cada entidad, qué
pantallas lo muestran y cómo funciona la aprobación manual. Describe `legacy-application` y
`legacy-backend` en las refs de `sources.json`.

## La probabilidad de cada entidad se calcula al listar

Al armar el listado (`LenderRetrievalService`, igual en los dos monolitos) cada entidad recibe un
puntaje y el listado se ordena por él. Hay tres fuentes:

- **Demográfica**: compara al cliente (edad, ingreso, monto, central de riesgo, ocupación) con las
  estadísticas de desembolsos de cada entidad, guardadas en la última fila activa de `profilings`. El
  puntaje mezcla por mitades lo bien que el cliente cae en los rangos de la entidad y la tasa de
  desembolso de la entidad (`weighted_score`; el porcentaje mostrado es ese puntaje por 100). El peso
  del score de crédito está fijado en cero en el código.
- **Matriz**: `matrixModelV2`, una tabla de reglas.
- **Modelo de ML**: el servicio de H2O. Si contesta, manda; si no, se usa la matriz.

El resultado queda en `profiling_reviews` por solicitud: las entidades mostradas, las reglas duras,
las tres predicciones y la entidad recomendada. Se reescribe sólo si la lista cambió. Cómo se ordena y
qué excluye el listado está en [el listado de entidades](knowledge:lender-listing).

La fila de `profilings` la arma `create-profiling` del admin recorriendo solicitudes históricas: el
modelo demográfico no se actualiza solo.

## Las pantallas del perfilamiento

| pantalla | qué muestra | quién la ve |
|---|---|---|
| **Usuarios perfilamiento** (admin y comercio) | qué entidades se le mostraron a cada solicitud y con qué probabilidad; se puede descargar | recorta por rol en el servicio; la ruta no pide permiso |
| **Pestaña Perfilamiento** de una solicitud | Datacrédito, ocupación, ingresos, continuidad laboral, la revisión de la política de riesgo y la capacidad de endeudamiento (pedidas a `legacy-backend`), el formulario dinámico y la última decisión manual | sólo si la entidad tiene aprobación manual y el usuario puede aprobar |
| **Revisión de perfilamiento** | cuántas veces la entidad recomendada fue la que desembolsó, por comercio y entidad | el menú pide «ver centrales de riesgo»; la ruta no pide permiso |
| **Validar usuario** | el perfil de riesgo de una cédula (Datacrédito, Ágil Data, Mareigua, TusDatos, capacidad de endeudamiento) y su historial por comercio | la ruta pide `view user validation module`; deja rastro. Quien no es Administrador sólo ve cédulas con solicitudes en sus comercios (`allied_id` o `multiple_allieds`, `RiskProfilePolicy::canViewClient`; si no, 403, después de dejar el rastro) y el historial por comercio se recorta a los suyos. El botón de consulta a Datacrédito sólo aparece con `view risk centrals module` (`can_query_datacredito`) |
| **Validar perfil** y **Pruebas del modelo** | el resultado demográfico y la matriz de una solicitud; las entidades y reglas duras de una cédula con un modelo local | sin permiso en la ruta |
| **Formulario de perfilamiento** (cliente, aplicación anterior) | ocupación, ingreso, estrato, central y estado civil antes del listado | ruta pública |

El recorte de **Validar usuario** se hace en el controlador y no en la vista: Inertia manda el payload igual, así que ocultar en el front no alcanzaría.

El lado del comercio en el asistente usa el puerto de `legacy-backend`
(`/api/loans/customer/user-profiling`), que hoy recorta distinto que `legacy-application`: sólo
traslada el filtro del asesor, y para él no incluye las solicitudes sin asesor de su sucursal.

## La aprobación manual

Es una variación por entidad (`lender_requirements.manual_approval`,
[recorridos](knowledge:origination-paths#variaciones-y-ajustes)). En el cupo extendido,
`ManualApprovalNextStepResolver` (`legacy-backend`) frena a la solicitud que entra con cupo y la deja
«Pendiente aprobación manual»; si ya fue aprobada, sigue al codeudor o a la fecha de pago.

La decisión se toma en la pestaña Perfilamiento del admin (`ManualApprovalService`,
`legacy-application`). Puede decidir el Administrador siempre; un usuario de entidad, si la solicitud es
de su entidad; cualquier otro, si es de un comercio a su alcance. Los dos últimos además necesitan el
permiso de aprobar manualmente. Aprobar pasa la solicitud a «Pendiente de formalización» y le manda
al cliente un enlace por WhatsApp para continuar; rechazar la pasa a «Negada». La transición bloquea la
fila y queda en el historial con quién la hizo.
