# <Nombre> · flujo
> **estado:** al día con main · <TL;DR: qué es este flujo, en 1 frase>

<!-- FLUJO = documentación productiva de UN flujo del ecosistema, sobre main. Es material
     de REFERENCIA. Contá solo lo DISTINTIVO; el tronco común (entrada→OTP→datos→marketplace)
     se da por sabido y se referencia. Una TAREA que cuelgue de acá NO repite esto: lo enlaza.
     Secciones sin marca = obligatorias; (opcional) = poné solo si el flujo lo amerita. -->

## Qué es
<Lo DISTINTIVO del flujo (no el tronco común), en 1 párrafo.>

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | <> |
| ¿Quién pone la plata / cobra? | <> |
| ¿Cómo cierra? | <> |
| ¿Simulable E2E? | <> |

## Cómo funciona
<Recorrido punta a punta. Diagrama de etapas (texto/numerado; el drawer no renderiza mermaid) si ayuda.>

## Estados y códigos
<!-- Sobre qué estado/código cae el flujo: lo que asserta un test. NO repitas el catálogo
     global (vive en la raíz) — referencialo y listá SOLO los estados/códigos distintivos. -->
<Estado(s) de llegada + códigos intermedios propios (y su namespace si no es user_request_statuses).>

## Sistemas externos <!-- (opcional) -->
<APIs/portales/MDM que toca el flujo: qué hace cada uno, endpoint, credencial por-lender. Solo los distintivos.>

## Dónde mirar
<!-- el índice para bajar al código: agrupá por subsistema → archivos clave -->
- **<subsistema>** (<repo>): `archivo`, `archivo` — <qué hace>.

## Frontera de simulación / harness
<!-- La sección de "cómo pruebo esto" sin leer el análisis maestro. Clave para el OKR de pruebas. -->
<Qué es inyectable vs frontera externa · qué mockear · qué seeder/fixture sembrar · cómo lo alcanza el harness (backend-e2e Go / frontend-e2e Playwright).>

## Datos de prueba / usuario que pasa <!-- (opcional) -->
<Receta concreta: qué buró/campos/monto hacen aprobar o rechazar, y por qué "no sale" por defecto. Para rt=1 el valor es el negativo: "no hay receta local, decide la API".>

## Gotchas / riesgos
<Lo no-obvio YA VERIFICADO: ambigüedades, hardcodes que lo tocan, por qué "no sale", colisiones de ID.>

## Preguntas abiertas <!-- (opcional) -->
<!-- separá lo NO confirmado de los Gotchas (verificados). Append-only; se vacía al confirmar. -->
- [ ] <duda a verificar>

## Diferencias vs otros flujos <!-- (opcional) -->
<Contraste explícito contra los hermanos (sobre todo variantes CreditopX) para desambiguar rápido.>

## Bitácora
<!-- fechado, append-only: cambios de REFERENCIA del flujo -->
- **YYYY-MM-DD** — <qué cambió y por qué>

## Enlaces
<Ficha del lender/flujo · análisis maestro (fuente del file:línea) · memorias.>
