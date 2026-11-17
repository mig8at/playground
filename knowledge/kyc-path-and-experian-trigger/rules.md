# KYC nuevo: qué camino toma una solicitud y cuándo se consulta Experian

Para una solicitud que ya va por el pipeline (`kyc-pipeline` cubre cómo se elige entre pipeline y
flujo viejo, y también cómo termina la corrida en el wizard): qué grafo recorre, cuándo se salta una
central por dato vigente y qué decide el disparador de Experian. Describe `legacy-backend` y
`customer-profiling-service` en `main`. Al lado vive el disparador viejo, con otras reglas, copiado en
los dos monolitos (última sección). Los grafos vigentes son filas de cada base: aquí está lo que siembran las migraciones y
lo que fijan los tests, no lo que tiene un ambiente.

## El tipo de grafo lo deduce el backend por sucursal

`GET /api/v2/onboarding/kyc-requirements/{ur}` responde `pipelineType`: `CREDITOP_X` si se cumple
cualquiera de tres condiciones, evaluadas en este orden: el comercio está en
`experian_trigger_bypass_rules.allieds`; la sucursal tiene asociada alguna entidad de `.lenders`; la
sucursal tiene una entidad con `lenders.response_type = 2`. Si no, `STANDARD`. Las dos últimas son por
sucursal y miran sólo la asociación en `lenders_by_allied_branches`, sin filtrar por estado.

Si el setting falta o no se lee, el backend responde `OBV27003` (500) en vez de asumir `STANDARD`. El
servicio reintenta esa actividad (2 intentos, 30 s cada uno) y, si sigue fallando, la corrida falla:
no cae a otro grafo.

## Pullman y DFS: un override en el servicio

`kyc_pipeline_type_by_partner` fija el tipo por comercio y gana sobre lo que dijo el backend; las
migraciones siembran Pullman (94) → `PULLMAN` y DFS (189) → `DFS`, con un solo override activo por
comercio. El grafo se busca por `(pipeline_type, country_code)` activo; sin fila para ese par la
corrida falla, sin caer a `STANDARD`.

## Los cuatro grafos

Todos empiezan en AgilData; con datos van a Experian, sin datos o con error a Mareigua, y Mareigua
igual.

- `STANDARD`: la especificación que los tests fijan como la de producción es Mareigua sin datos →
  TusDatos → formulario laboral → Experian Acierta. La migración 000002 sembró otro orden (laboral
  antes de TusDatos); una base recién migrada puede tener ése.
- `CREDITOP_X`: el mismo recorrido, terminando en Acierta+Quanto.
- `PULLMAN` y `DFS` (el mismo grafo): sin nodo laboral; toda rama, también AgilData o Mareigua con
  datos, termina en Acierta+Quanto.

En los cuatro, TusDatos sigue por las tres aristas. Si TusDatos lanza un error, el nodo queda
`UNAVAILABLE` y la corrida continúa por la arista de éxito.

## Antes de cada central, el dato vigente

El servicio ya no pregunta por la frescura: no llama `POST /api/v2/risk/risk-central-data/check/{central}/{userId}` ni ningún otro endpoint del monolito para decidir si lo que ya hay alcanza. Cada nodo de proveedor, Experian incluido, es una sola actividad `AcquireProviderData` que le pide el producto a risk-service (gRPC `AcquisitionService.Acquire`, sólo con identificadores y una clave de idempotencia). Es risk-service quien decide, antes que cualquier otra regla, si lo que ya hay de esa persona alcanza. (Antes de recorrer el grafo, el servicio sí le pregunta al monolito `GET /api/v2/onboarding/kyc-requirements/{ur}`, que puede saltar centrales enteras; eso no es una comprobación de frescura.)

Esa comprobación (etapa `REUSE` del protocolo de risk-service, la primera para todos los productos, identidad incluida) conserva el contrato del monolito: ventana de 30 días por producto (`DefaultReuseWindow`, leída de la política resuelta y no de un `MAX_AGE_DAYS` por pre-procesador) y `FreshnessOnly = true`, o sea `checkJustFreshness`: cuenta la fecha, no si la consulta salió bien, y no se aplica la regla de resultado del proveedor. Primero se mira lo último del producto pedido (`Reuse.Held`) y, si no sirve, la cobertura entre productos del buró (`Reuse.Cover`). Si algo alcanza, el resultado es `REUSED`: el recorrido lo enruta por la arista de éxito igual que una consulta nueva, el nodo queda `OK` y no se consulta ni se cobra. Por eso un Experian reciente pero fallido evita una nueva compra.

En Experian se reutiliza entre productos: un combinado vigente responde por Acierta o Quanto sólo si trae esa sección (`models` para Acierta; el producto de código 62 dentro de `productValueList` para Quanto), y Acierta + Quanto vigentes por separado responden por el combinado. Acierta sola nunca responde por el combinado. A diferencia del monolito, que escribe una fila combinada al fusionar las dos, risk-service las compone en memoria, no escribe nada y fecha el resultado con la más vieja de las dos.

El endpoint `check/{central}/{userId}` sigue existiendo en `RiskV2` del monolito, pero este pipeline ya no lo usa.

## El disparador, etapa por etapa

`GET /api/v2/risk/check-hard-rules-trigger/{variante}/{ur}` corta en la primera que decide:

0. la solicitud debe tener sucursal, comercio y usuario;
1. dato vigente y exitoso de esa variante → `RKV24027`, no consultar;
2. flujo de preaprobación ya confirmada (`flow_id` 2) → `RKV24029`;
3. bypass: las mismas tres condiciones de `CREDITOP_X` → consultar (`RKV24020`, `RKV24021`,
   `RKV24030`) con la variante forzada a Acierta+Quanto, sin tocar el contador;
4. frecuencia del comercio (siguiente sección);
5. si la sucursal no tiene reglas `datacredito_trigger` → consultar (`RKV24007`). Si las tiene, exige
   y rechaza en este orden: usuario existente y habilitado (`RKV24004`, `RKV24005`), perfil cliente
   (`RKV24026`), documento `CC` o `CE` (`RKV24028`: cualquier otro tipo no se consulta), algún valor de
   campo (`RKV24006`) y los campos 160 reportes, 29 situación laboral y 87 ingreso (`RKV24013`,
   `RKV24014`, `RKV24015`);
6. regla del comercio (hoy sólo Pullman: monto ≤ 600.000 → `RKV24019`) y regla de cada entidad activa
   en comercio y sucursal (hoy sólo Credifamilia → `RKV24025`);
7. reglas de la sucursal: situación laboral, género, reportes, ingreso mínimo y edad → `RKV24000`.

Como la etapa 5 responde antes, en una sucursal sin reglas no corren ni la regla de Pullman ni la de
Credifamilia. Una sucursal de Pullman que cumple el bypass también se las salta.

## Frecuencia: uno de cada N

Sin regla de frecuencia para el comercio → `RKV24023`, no consultar. Con regla, se lee el contador
compartido del comercio y se exige `contador % every == 0`. Si no toca, responde `RKV24024` y avanza el
contador. Si toca, el contador avanza sólo justo antes de un «consultar» ordinario (`RKV24000` o
`RKV24007`). Un rechazo en las etapas 5 a 7 no lo mueve, y la siguiente evaluación vuelve a tener turno.

`frequency` nulo significa «siempre»: se usa el contador como `every`. Con el contador en 0 la primera
evaluación da `RKV24024` y lo deja en 1.

## Lo que el servicio hace con el veredicto

El servicio no decide el disparador ni interpreta los códigos `RKV`: ya no llama a `check-hard-rules-trigger` ni compra la variante que le diga el monolito. Eso ocurre dentro de risk-service, que traduce el veredicto del disparador (`triggerTranslations`) y contesta con un `outcome` cerrado, que es lo único por lo que el recorrido enruta; el `reason_code` se guarda, nunca se enruta.

- `ALLOWED_ACQUIRED` y `REUSED` (el nodo queda `OK`) toman la arista de éxito. Autorizan `RKV24000`, `RKV24007`, `RKV24020`, `RKV24021` y `RKV24030`; `RKV24027` (ya hay dato vigente) es `REUSED`.
- `NO_BUREAU_DATA` queda `NO_DATA`; `DENIED_BY_POLICY` (los rechazos conocidos del disparador) queda `SKIPPED`; `SUSPENDED` (adquisición retenida, por ejemplo por el cortacircuitos) queda `UNAVAILABLE`. Los tres toman la arista de sin datos (o la de éxito si el nodo no la declara) y cuentan como cierre válido.
- `ERROR`, un `outcome` vacío o desconocido y un código de veredicto que risk-service no tiene traducido (`TRIGGER_CODE_UNTRANSLATED`) toman la arista de error. Ya no se vuelven `SKIPPED`.

La actividad (`AcquireProviderData`) se reintenta ante una falla técnica: 2 intentos de 30 s, siempre con la misma clave de idempotencia (`kyc-pipeline/<solicitud>/<run>/<nodo>/<correcciones de TusDatos>`), para que un reintento no compre dos veces. La única falla técnica que no corta el recorrido es la de TusDatos: queda `UNAVAILABLE` y sigue por la arista de éxito.

Si autoriza, risk-service compra el producto que dicte su política y el servicio lo lee de `product_acquired` (`answeredBy`) y lo registra bajo ese proveedor aunque el nodo pidiera otro. La etapa `MANDATE` (comercio en la lista, sucursal con entidad de la lista o con entidad CreditopX) manda Acierta + Quanto (`MandatedProduct`); por eso una sucursal así compra el combinado sea cual sea el grafo.

Aparte, `SKIPPED` también lo escribe el servicio cuando `kyc-requirements` salta un proveedor (PEP, comercio sin fecha de expedición, país sin centrales), con las razones en el `ReasonCode` del resultado.

## El disparador viejo, en los dos monolitos

Fuera del pipeline decide `DatacreditoQueryByAlliedController::userViability`, con dos copias de la
misma lógica que ya no coinciden en todo (ver más abajo: la regla de edad, la excepción de Prami y el producto que compran):

- en `legacy-backend`, `Modules/Risk` (no `RiskV2`), que llaman `OnboardingController`,
  `OnboardingService` y `CreditStudyService`;
- en `legacy-application`, que llaman el listado de entidades, la información personal y la validación del OTP.

La copia de `legacy-backend` agrega una puerta antes de todo: si el país del comercio no tiene
centrales de riesgo habilitadas, no consulta (`no_active_risk_centrals_for_country`). Las dos dejan cada
decisión en la tabla `logs` (`controller = 'DatacreditoQueryByAlliedController'`, `name`
`EXPERIAN_TRIGGERED` o `EXPERIAN_NOT_TRIGGERED`, el motivo en `request.reason`), con el mismo formato:
la fila no dice qué monolito la escribió. En Loki sí: lo dice `service_name`.

No usan los códigos `RKV` y en dos puntos deciden al revés que el disparador de `RiskV2`:

- **Sin reglas `datacredito_trigger` en la sucursal, no consultan nunca**
  (`no_datacredito_trigger_configured`). `RiskV2` consulta en ese caso (`RKV24007`).
- **No tienen bypass dentro de `userViability`:** comercio en la lista, entidad de la lista o
  `response_type = 2` no fuerzan nada ahí. Lo que fuerza la compra está antes, en quien lo llama: en
  `legacy-backend`, `OnboardingService::resolveForcedExperianProduct` (lee `experian_trigger_bypass_rules`:
  comercio o entidad de la sucursal en la lista compra `creditScore` si AgilData o Mareigua ya devolvieron
  ingreso vigente y `aciertaQuanto` si no; una sucursal con entidad CreditopX compra `creditScore`) y, si
  compró, `userViability` no se llama (`experian_already_triggered`); en `legacy-application`, el
  `alliedsLendersValidator` de `PersonalInfoController`, que compra `aciertaQuanto`.

Qué entidad hace evaluar la consulta aunque las reglas fallen, y qué se compra, es lo que distingue a las
dos copias:

- **`legacy-backend`:** cualquier entidad con `lenders.requires_preapproval_gate = true` que esté activa
  (`lenders.status = 1`) en la sucursal (`lenders_by_allied_branches`) y en el comercio
  (`lenders_by_allieds`) y tenga integración completa (`HasActiveIntegratedEntitiesService` de `LenderV1`
  con `justFullyIntegratedLenders = true`: credencial de integración de la sucursal o del comercio en
  `lender_allied_credentials`; `LNV11000` cuenta, `LNV11001` pasa a la siguiente entidad y cualquier otro
  código lanza excepción) hace evaluar la consulta
  (`datacredito_evaluated_by_preapproval_gated_lender_despite_failed_rules`). `validateDatacreditoQuery`
  compra siempre `creditScore` (Acierta): la entidad cambia si se evalúa, no qué se compra.
- **`legacy-application`:** sigue fijo **Prami (12)** (`hasActiveIntegratedPrami`): si está activa como
  entidad, en la sucursal y en el comercio, y tiene credencial de integración de la sucursal o del
  comercio, evalúa aunque las reglas fallen (`datacredito_evaluated_by_prami_despite_failed_rules`). Con esa
  Prami compra Acierta+Quanto (también cuando las reglas pasan); sin Prami, `creditScore`.

Con reglas, falla si no se cumple alguna: Pullman (94) con monto ≤ 600.000, situación laboral (29),
género, reportes (160), ingreso mínimo (87) o edad. La regla de edad difiere entre las copias: en
`legacy-application` la edad debe quedar estrictamente entre el mínimo y el máximo (falla si
`edad <= mínimo` o `edad >= máximo`); en `legacy-backend` la condición es `edad <= mínimo && edad >= máximo`,
así que con un rango normal (mínimo < máximo) nunca falla y sólo descalifica un rango invertido. La vía
«por entidad» (`validateViabilityByLender`) está apagada en las dos: la lista de entidades con credencial
de Datacrédito está vacía en el código, así que nunca suma.

Frecuencia: sin fila de frecuencia del comercio, no consulta (`no_datacredito_frequency_for_allied`).
Con `frequency` nulo, consulta siempre. Si no, avanza el contador **antes** de comparar y consulta
cuando `contador % every == 0`. Un `every` menor que 1 se toma como «no consultar».
