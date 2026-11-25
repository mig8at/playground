# Documentos de firma: Blade y pdf-mapper

Cómo `legacy-backend` (main) convierte un documento de firma en PDF: los dos motores que conviven, quién elige cuál en
cada juego de firma y de dónde salen los datos que llenan la plantilla. Qué juego se le muestra al cliente está en
[la firma en casa](knowledge:origination-paths#la-firma-en-casa-que-documentos-se-muestran-y-se-firman). Qué entidad
usa qué motor en un ambiente se mide en su base (`lender_signing_documents.generator`,
`netco_lender_documents.generator`).

## Dos motores vigentes, no uno viejo y otro nuevo

- **Blade** (`BladePdfGenerator`): la plantilla es una vista del repo (`resources/views/creditopxpdf/…`) que DomPDF
  convierte en PDF, con los assets remotos habilitados. Es el motor por defecto de todo.
- **pdf-mapper** (`PdfMapperGenerator`, que llama al servicio `pdf-mapper-service` por `PdfMapperClient`): la
  plantilla es el PDF original de la entidad, con los campos ubicados en PDF Mapper Studio. legacy-backend pide
  `/api/projects/{proyecto}/documents/{documento}/generate`: el proyecto es `lenders.pdf_mapper_project_slug` y el
  documento es el tipo del generador, salvo que `documents.service_document_name_by_lender` lo renombre para esa
  entidad. No atiende los tipos con tablas dinámicas o cifrado (`payment-schedule-fee-change`,
  `payment-schedule-revolving`, `statement-of-account`): esos siguen en Blade.

Ninguno reemplaza al otro. `config/documents.php` describe pasar una entidad o un tipo a pdf-mapper como un cambio
gradual por variable de entorno, y los dos módulos de firma nuevos (el catálogo y SigningV1) aceptan los dos motores
por documento.

## Quién elige el motor en cada juego de firma

| juego | dónde se elige | motor | si falla |
|---|---|---|---|
| **firma configurable** (SigningV1, con Netco) | `netco_lender_documents.generator`, por documento | `blade` (vista en `template`) o `pdf_mapper` (nombre en `pdf_mapper_document`); otro valor lanza | **no hay respaldo**: si pdf-mapper o la vista fallan, la firma falla, para no firmar un documento distinto del configurado |
| **juego fijo de Credifamilia** | `CredifamiliaDocumentsBuilder` | siempre pdf-mapper, con el proyecto de la entidad de la solicitud | sin respaldo a Blade |
| **catálogo** (`lender_signing_documents`) | la columna `generator` de la fila: `blade` o `microservice`; en `NULL`, como el juego estándar | Blade con la vista de `template`, o pdf-mapper con el tipo como nombre | pdf-mapper sin la plantilla (`TemplateNotFoundException`) cae a Blade (`FallbackDocumentGenerator`) |
| **juego estándar** (consentimiento, pagaré, garantía) | `config/documents.php`, por tipo (`DOC_GEN_*`) y con excepciones por entidad | Blade por defecto | igual que el catálogo |

Con Blade y sin plantilla explícita, la vista sale de `BladePdfGenerator`: una por tipo (`VIEW_MAP`) y, para el pagaré,
el consentimiento y la garantía, una por entidad si existe (`creditopxpdf.lenders.lender_<id>`, `…consents.consent_<id>`,
`…guarantees.lender_<id>`), con la genérica de respaldo. Una vista nombrada en el catálogo o en SigningV1 que no existe
lanza: no cae a la genérica.

El tipo del catálogo se traduce al del generador con `GeneratorTypeMap` (`promissory_note` → `pagare`,
`payment_schedule` → `payment-schedule`…); un tipo nuevo pasa tal cual. Ese nombre decide el tamaño de papel en Blade
(el plan de pagos va en carta) y el nombre del documento en pdf-mapper.

## Los datos: un payload builder por entidad, igual para los dos motores

El motor sólo dibuja. Las variables las arma un `DocumentPayloadBuilder`, que se elige por entidad
(`CatalogDocumentPayloadResolver::builderClassFor`), en este orden:

1. por prefijo de la plantilla (`creditopxpdf.lenders.alta.` → `AltaPayloadBuilder`);
2. por `slug` de la entidad (`credi-asyco` → `CrediAsycoPayloadBuilder`, `banco-finandina` → `FinandinaPayloadBuilder`);
3. por `lenders.product` (`renting` → `MotaiRentingPayloadBuilder`, `rto` → `MotaiRentToOwnPayloadBuilder`);
4. si no, `OnboardingPayloadBuilder`, el genérico, que es el que usa Credifamilia.

No se elige por id porque el id de una entidad cambia entre ambientes. SigningV1 usa la misma regla salvo que la fila
nombre su builder (`payload_builder`), y arma el payload una vez por solicitud para todos sus documentos. En Blade, una
plantilla que pide una variable que el builder no produce falla al renderizar y la firma cae.

## Qué hace falta para los documentos de una entidad nueva

- **Por Blade:** las vistas en `resources/views/creditopxpdf/lenders/<entidad>/`, un builder si el genérico no alcanza
  (y su entrada en el resolutor) y las filas del catálogo o de SigningV1 con `generator = blade` y la vista.
- **Por pdf-mapper:** el proyecto de la entidad en PDF Mapper Studio con un documento por tipo, su
  `pdf_mapper_project_slug`, el builder igual que en Blade y las filas con el motor de pdf-mapper. Sirve cuando la
  entidad exige su PDF idéntico; las claves del builder tienen que coincidir con los campos mapeados.
- **El pagaré con catálogo:** si la entidad tiene filas en `lender_signing_documents`, el pagaré sale sólo si hay una
  fila `promissory_note`, y sin plantilla para que vaya por Deceval
  ([el pagaré](knowledge:deceval-promissory-note#que-manda-un-pagare-a-deceval)). Cargar los documentos propios sin esa
  fila deja a la entidad firmando sin pagaré.
