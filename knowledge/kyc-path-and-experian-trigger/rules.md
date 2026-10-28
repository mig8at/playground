# KYC nuevo: qué camino toma una solicitud y cuándo se consulta Experian

Para una solicitud que ya va por el pipeline (`kyc-pipeline` cubre cómo se elige entre pipeline y
flujo viejo, y también cómo termina la corrida en el wizard): qué grafo recorre, cuándo se salta una
central por dato vigente y qué decide el disparador de Experian. Describe `legacy-backend` y
`customer-profiling-service` en `main`; `application` no tiene nada de esto. Los grafos vigentes son filas de cada base: aquí está lo que siembran las migraciones y
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

Antes de cada nodo, incluido Experian y antes del disparador, el servicio pregunta
`POST /api/v2/risk/risk-central-data/check/{central}/{userId}`. Si hay un registro de menos de 30 días
(`MAX_AGE_DAYS` de cada pre-procesador) el nodo queda `OK` sin consultar. Ese chequeo usa
`checkJustFreshness = true`: cuenta la fecha, no si la consulta salió bien. Un Experian reciente pero
fallido evita una nueva compra en el pipeline, aunque la etapa 1 del disparador, que es estricta, no lo
daría por vigente.

En Experian se reutiliza entre productos: un combinado vigente responde por Acierta o Quanto si trae
esa sección, y Acierta + Quanto vigentes por separado se fusionan en una fila combinada. Acierta sola
nunca responde por el combinado.

## El disparador, etapa por etapa

`GET /api/v2/risk/check-hard-rules-trigger/{variante}/{ur}` corta en la primera que decide:

0. la solicitud debe tener sucursal, comercio y usuario;
1. dato vigente y exitoso de esa variante → `RKV24027`, no consultar;
2. flujo de preaprobación ya confirmada (`flow_id` 2) → `RKV24029`;
3. bypass: las mismas tres condiciones de `CREDITOP_X` → consultar (`RKV24020`, `RKV24021`,
   `RKV24030`) con la variante forzada a Acierta+Quanto, sin tocar el contador;
4. frecuencia del comercio (siguiente sección);
5. si la sucursal no tiene reglas `datacredito_trigger` → consultar (`RKV24007`). Si las tiene: perfil
   cliente, documento `CC` o `CE` y los campos 160, 29 y 87;
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

Sólo `RKV24000`, `RKV24007`, `RKV24020`, `RKV24021` y `RKV24030` autorizan. Los rechazos conocidos,
un código desconocido, un status distinto de 200 o un error de red dejan Experian `SKIPPED`, que cuenta
como cierre válido. El disparador corre con un solo intento, sin reintentos. Si autoriza, el servicio
compra la variante que devolvió `data.variant` aunque el nodo pidiera otra; por eso una sucursal con
bypass compra el combinado sea cual sea el grafo.
