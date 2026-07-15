# Motai v2 · Tipos de documento por sucursal (des-hardcode del PEP)

**Pieza de la des-motaización.** Sacar de código el "si Motai renting → mostrá PEP" y
volverlo **configuración por sucursal**, de modo que el frontend muestre los tipos de
documento según lo que la sucursal habilita — no según un `if` por modo/ID.

## Problema (hoy, quemado en el front)
- `frontend-monorepo/.../loan-application-form/.../forms/personal-info-form.tsx:63` arranca con
  `documentTypeOptions.filter(o => o.value !== "PEP")` (PEP fuera) y un `useEffect` (línea 66) lo
  re-agrega **solo si `merchantMode === "motai-renting"`**.
- `.../lib/types/document-type.ts`: el enum `["CC","CE","PEP"]` y las opciones están **fijos** en el front.
- `merchantMode` vive en la sesión (`session.get("merchant-mode")`), seteado al elegir el modo del comercio.

Resultado: el tipo de documento depende de un modo quemado; no escala a "esta sucursal (país/mercado)
acepta estos documentos".

## Decisión
Un campo **`allowed_document_types`** (array de códigos, ej `["CC","PEP"]`) que el backend **resuelve por
sucursal** y devuelve en la config de personal-info. El front solo renderiza ese subconjunto. El enum del
front pasa a ser el **catálogo maestro** (canónico) y la sucursal define el subconjunto visible.

Se descartó mandar la lista completa de entidades al front para que filtre: para ESTE caso alcanza con la
unión resuelta en backend (más simple, menos acople, menos data).

## Modelo de datos
Nueva columna **`document_types`** (JSON array de códigos) en **`lenders_by_allied_branches`** — la fila
lender×sucursal, que ya guarda `url_utm/sort/status` (es la "copia prendida/apagada por sucursal"). Guardar
ahí los tipos habilitados es consistente con cómo ya funciona la tabla.

- Migración en **application Y legacy-backend** (BD COMPARTIDA, parallel-run): ambos DEFINEN la tabla, así
  que el `ALTER` va en los dos repos para paridad de esquema; corre **una sola vez** contra la BD compartida
  (coordinar cuál la aplica).
- **Índice en `allied_branch_id`**: la migración `2023_07_17_..._create_lenders_by_allied_branches_table.php`
  NO declara índice en esa columna (es un `integer` pelado) → hoy el `WHERE allied_branch_id = ?` hace full
  scan (~37k filas, ver HALLAZGO-GESTION-REGLAS-POR-SUCURSAL). Esa query ya corre en TODO listado
  (`LenderRepository::getLendersByAlliedBranch`), así que **agregar el índice es un arreglo pendiente que
  conviene meter acá**.
- Modelo `LendersByAlliedBranch`: sumar `document_types` a `$fillable` + `$casts` (array) en ambos repos.
- **Semántica de null/default**: fila sin `document_types` (todas las existentes) → se trata como `["CC"]`
  (no cambia nada para lenders no-Motai). Solo las filas de Motai renting se siembran con `["CC","PEP"]`.

## Backend (legacy-backend · Onboarding)
Endpoint YA existente (recibe el hash de la sucursal):
```
GET /api/onboarding/loan-application/personal-info/{partner_branch_hash}/{user_request_id}/config
→ OnboardingController@getPersonalInfoConfig  (línea ~1606)
```
Hoy devuelve `should_use_manual_birth_date` + `should_collect_stratum`. Se le agrega:
```
allowed_document_types: ["CC","PEP"]
```
Cálculo (con el `$branch` que el método ya resuelve del hash):
```
allowed = {"CC"}  ∪  ⋃ ( row.document_types )   para cada fila de
          lenders_by_allied_branches con allied_branch_id = $branch->id AND status = 1
```
- **CC siempre presente** (piso universal; nunca lista vacía).
- La unión sobre las entidades ACTIVAS de la sucursal resuelve el orden del flujo: el tipo de documento se
  pide en personal-info **antes** de elegir la entidad, así que se usa lo habilitado a nivel sucursal, no una
  entidad puntual.
- Query = la que ya existe (`LenderRepository`, filtro por `allied_branch_id`). Ver **Costo**.

## Contrato API (nuevo campo)
```jsonc
// data del /personal-info/{hash}/{lr}/config
{
  "should_use_manual_birth_date": false,
  "should_collect_stratum": false,
  "allowed_document_types": ["CC", "PEP"]   // NUEVO — subconjunto del catálogo maestro
}
```

## Frontend (frontend-monorepo · loan-application-form)
- `personal-info-config/types/personal-info-config.ts`: sumar `allowed_document_types: string[]` al schema
  zod + `allowedDocumentTypes` al tipo `PersonalInfoConfig`.
- `personal-info-form.tsx`: **borrar** el `useState(filter !== "PEP")` + el `useEffect(merchantMode)` y usar
  `options = documentTypeOptions.filter(o => allowedDocumentTypes.includes(o.value))`.
- `document-type.ts`: el enum/opciones quedan como **catálogo maestro** (agregar tipos futuros acá: pasaporte,
  DNI, etc.). Ya no decide qué se muestra.
- Se deja de usar `merchantMode` para el tipo de documento (sigue existiendo para otras cosas hasta que el
  "modo" muera del todo en v2).

## Costo de la consulta
Barato. La query es `WHERE allied_branch_id = ?` → devuelve solo las entidades de ESA sucursal (un puñado a
unas decenas de filas), y ya se ejecuta hoy en cada listado. Sumar `document_types` al select + unir en
backend es O(N) sobre esas pocas filas. **Único caveat**: falta el índice en `allied_branch_id` (ver arriba)
→ agregarlo. Con índice, la consulta es trivial.

## Encaje con Motai v2
Es el patrón de la des-motaización: config heredable en vez de `if` por ID/modo. Cuando el "modo" muera y los
productos pasen a ser **lenders CreditopX por categoría**, los tipos de documento viajan naturalmente con el
lender/categoría (su fila por sucursal), y el front los lee del config. Un `isMotaiRenting`/`merchantMode`
menos quemado.

## Fuera de alcance / follow-ups
- **Alta/admin**: que al habilitar una entidad en una sucursal (Admin/Allied*Controller en application) se
  puedan setear sus `document_types`. Por ahora: seed de las filas de Motai renting con `["CC","PEP"]`.
- Ampliar el catálogo maestro con tipos de otros países (pasaporte/DNI…) cuando exista una sucursal fuera de CO.
- Otros `isMotaiRenting`/`merchantMode` quemados (privacy/terms URLs, bypass de cuota inicial, OTP) = piezas
  aparte de la des-motaización.
