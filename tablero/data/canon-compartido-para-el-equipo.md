---
id: 67
title: "Canon compartido: el conocimiento de negocio, publicado para el equipo y consultable por API"
stage: work
created: "2026-08-25T12:00:00-05:00"
context_nodes: [creditop, negocio, findings, architecture]
jira: []
jira_title: "Documentación de negocio compartida para el equipo"
---

**ESTADO 2026-08-25.** La herramienta existe y pasa el CI del repo compartido: `Creditop-SAS/playground`
→ `tools/canon` (Go, cero dependencias, corpus embebido en el binario, lint que bloquea el deploy).
**Sin commitear** — el PR lo abre Miguel. Hay **7 nodos escritos de ~20**: `canon.money`,
`canon.invariants`, `canon.entity-families`, `canon.lifecycle`, `flows.entity-listing`,
`flows.origination`, `map.database`. Este archivo lleva EL MAPEO: qué nodo del `context/`
local alimenta qué nodo del corpus compartido.

## Las reglas de la migración

1. **Se REESCRIBE, no se copia.** Los docs locales tienen 1.024 citas `archivo:línea` y 781 `F-xx`;
   el lint del canon los rechaza tal cual. Migrar = destilar lo que sobrevive a la regla
   **nombre-vs-dirección** (tablas/settings/estados sí; archivos/clases/funciones/endpoints no).
2. **Sin F-xx en el compartido.** La trampa se cuenta completa (síntoma → causa → cómo se verificó);
   el registro F-xx sigue siendo LA FUENTE, acá en el playground personal. La procedencia va en la
   sección obligatoria «Cómo lo sabemos».
3. **`verified:` hereda la fecha del sello local.** 30 de 39 sellos son ≤2026-07-31: si el sello está
   viejo, re-verificar ANTES de migrar (`make context-diff NODE=x`), no después.
4. **Techos del lint:** 1500 palabras/nodo · 350/sección (400 en field/pitfalls) · summary ≤350
   caracteres. Los nodos locales de 3-5k palabras se parten o se destilan.
5. **Idioma:** ids/rutas/campos en inglés; prosa en español. La capa es un campo, no una carpeta:
   `content/<id>.md` plano.

## El mapeo — 39 nodos locales → ~20 compartidos

| local | destino compartido | nota |
|---|---|---|
| negocio | **canon.money** ✅ | hecho; el detalle de vistas con línea queda |
| creditop (raíz) | **canon.invariants** ✅ + canon.lifecycle + canon.glossary | 7 de 8 invariantes migraron; el fail-open de filtros por rol → pitfalls.access (es temporal, no invariante); la arista con archivo:línea queda |
| entities | **canon.entity-families** ✅ | el rt 0-4 como modelo de negocio; censo técnico queda |
| creditopx | **canon.entity-families** ✅ + **flows.entity-listing** ✅ | |
| kyc | canon.risk-assessment + flows.origination | fixtures/mocks quedan (laboratorio) |
| actors | canon.actors | Cognito detalle queda |
| profiling | flows.entity-listing + canon.risk-assessment | features del ML quedan |
| amount-tiers | flows.entity-listing | se funde |
| rotativo | flows.post-disbursement + canon.entity-families | rt=3 no comparte motor: eso es canon |
| onboarding | **flows.origination** ✅ | |
| formalization | flows.formalization | |
| deceval | flows.formalization | el detalle SOAP/WS-Security queda |
| codeudor | flows.formalization | |
| payments | flows.payments | el bug vivo del gateway → pitfalls.payments |
| servicing | flows.post-disbursement | |
| ecommerce | flows.channels | |
| redirect | flows.channels | |
| aggregator | flows.external-lenders | webhook de ida y vuelta, pre-aprobación |
| ms-preapprovals | map.services + flows.external-lenders | |
| bancolombia | field.entity-bancolombia | específico y cambiante → field con fecha |
| credifamilia | field.entity-credifamilia | |
| corbeta | flows.channels + field.merchant-corbeta | venta en caja es flujo; el grupo es field |
| smartpay | field.merchant-smartpay | |
| motai | field.merchant-motai | |
| pullman | field.merchant-pullman | chico |
| merchants | field.merchants | par/copia ya graduó a canon.invariants |
| architecture | map.repos | las costuras: lo conceptual migra |
| application | map.repos | casi todo queda (denso en direcciones) |
| legacy-backend | map.repos | ídem |
| frontend-monorepo | map.repos | ídem |
| microservicios | map.services | service_name es vocabulario, migra |
| form-service | map.services | |
| backoffice | map.services + canon.actors | |
| dynamic-forms | map.services (+ flows.forms candidato) | |
| db-routines | **map.database** ✅ (parcial: falta la lógica en rutinas) | el HECHO de la lógica en BD; 4 rutinas sin fuente |
| hardcodes-entidades | queda personal | censo con archivo:línea; el agregado medido → field candidato |
| findings (174) | pitfalls.\* temáticos | ~139 candidatas; ~35 de laboratorio quedan; ver regla 2 |
| harness | NO migra | herramienta personal |
| trazador | NO migra | herramienta personal |

## Fases

- **F1 · canon:** entity-families ✅ · lifecycle ✅ · **restan** actors → risk-assessment → glossary.
  Es el vocabulario: sin esto, el resto se lee mal.
- **F2 · flows:** origination ✅ · **restan** formalization → payments → post-disbursement → channels →
  external-lenders.
- **F3 · map:** database ✅ · **restan** repos → services.
- **F4 · pitfalls temáticos**, empezando por lo que soporte pregunta: states → webhooks →
  entity-listing → access.
- **F5 · field** — DESPUÉS de decidir la sensibilidad (abajo).

## Regla editorial que salió de escribir los primeros nodos

**Cada sección aporta un hecho que no está en otra sección.** Se sacó de `flows.entity-listing` la
sección «Qué preguntar cuando el listado sale mal»: era una checklist que restataba reglas ya escritas
en el mismo nodo. Una copia dentro del corpus es peor que una ausencia — las dos derivan y la búsqueda
devuelve la más débil. Corolario implementado: **«Cómo lo sabemos» no entra al índice de búsqueda**
(es procedencia, no respuesta); medido, salía SEGUNDA en una consulta de contenido.

## Decisiones abiertas

- **La frontera con credibrain** (herramienta de Oscar en el mismo catálogo, «la memoria de la
  compañía»). Mi lectura: canon = fuente curada; credibrain = el que contesta y cita. Hablarlo antes
  del PR.
- **La ficha de entidades** (aprobación, embudo, ticket por entidad — hoy `context/docs/ENTIDADES.md`):
  con `para: compania` la ve toda la empresa. ¿Entra, y con qué recorte?
- **Quién sella en el compartido:** ¿el review del PR equivale al `verified:`? Propuesta: sí — quien
  aprueba el PR pone su nombre en la fecha.

## Bitácora

- 2026-08-25 · +4 nodos (entity-families, lifecycle, origination, database) usando `workers negocio`
  (la espina de 23 conceptos) y `workers relaciones` (13 vecindarios medidos contra prod) como
  esqueleto derivado del código. Stopwords + procedencia fuera del ranking. CI verde.
- 2026-08-25 · armada la herramienta completa (API index/search/read/relations/policy/tools, lint,
  stopwords, índice-como-documento) + 3 nodos + este mapeo. CI del repo compartido verde.

## Tarea (publicable)

**En una línea:** Publicar la documentación de negocio en un repositorio compartido del equipo,
consultable por personas y por modelos vía API.

**Por qué:** El conocimiento del sistema vive hoy en notas personales; soporte, QA y producto lo
necesitan sin depender de una persona.

**Qué cambia:** Aparece una herramienta interna con la documentación por capas —reglas de negocio,
responsabilidades, flujos de punta a punta, observaciones fechadas y trampas conocidas— con búsqueda
y lectura por API.

**Alcance:** Solo lectura; los cambios entran por revisión. No incluye credenciales ni detalles de
implementación.
