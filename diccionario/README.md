# diccionario — el catálogo del PDF Mapper como diccionario canónico

Prototipo (Vue 3 + Vite) que toma el **catálogo real del PDF Mapper**
(`src/catalog.json`, el export literal del editor — dev == prod, `seededVersion 9`,
128 campos) y lo trata como un **diccionario canónico de ids de campos**: ver,
buscar, previsualizar y crecerlo bajo reglas seguras.

No es producción ni pega contra ningún backend: es un espacio para ver y discutir
la forma sobre datos reales. El estado vive en memoria + `localStorage` (botón ↺
restaura el catálogo real).

## Por qué "diccionario" y por qué contra el catálogo real

Aterrizado contra `context` (nodos `dynamic-forms` / `form-service` / `kyc`), el
hallazgo es que **CreditOp no tiene un catálogo canónico de campos en código**: qué
significa cada id vive solo en datos. El catálogo del PDF Mapper es el catálogo
curado que sí tenemos, así que el prototipo arranca de ahí — datos que el equipo
reconoce, no una semilla inventada.

## Las reglas que prototipa

1. **Una fuente de verdad.** El mismo id (`first_name`, `city`,
   `data_processing_consent`) es *el mismo campo*. `catalog.json` se pega tal cual
   sale del editor; el adaptador de `dictionary.ts` lo normaliza.
2. **La forma real del campo.** `{ id, type, label, options?, defaultValue }`:
   - `text` / `checkbox` → `defaultValue` es el **valor de ejemplo** (preview).
   - `checkbox` de **1 opción** = casilla de consentimiento; de **varias** =
     selección única.
   - `table` → `defaultValue` es el arreglo de **celdas** (fila/columna + posición
     `x,y,w` normalizada 0–1 sobre la página); la preview arma la grilla.
3. **Append-only (seguro por construcción).** Se **agrega** y se **depreca**
   (reversible); **nunca** se edita in-place ni se borra. No es capricho: el mismo
   id lo leen las plantillas ya mapeadas, así que reusar/mutar una definición
   cambiaría documentos viejos. Deprecar no destruye: sigue resolviendo
   `type`/`label` para lo viejo, pero deja de ofrecerse para lo nuevo.

## Qué se ve

- Lista del catálogo (128 campos) con búsqueda, filtro por tipo y toggle de obsoletos.
- Detalle de cada campo: id, tipo, etiqueta, opciones, valor de ejemplo, celdas.
- **Vista previa** del campo renderizado (input / casilla / radios / tabla).
- Alta append-only (valida id `snake_case` único).
- Deprecar / reactivar (con motivo), sin opción de editar ni borrar.

## Correr

```bash
cd playground/diccionario
npm install
npm run dev        # http://localhost:5194  (o `diccionario` en el panel de launch)
```

## Estructura

```
src/
├── catalog.json    ← el catálogo REAL del PDF Mapper (fuente de verdad, verbatim)
├── dictionary.ts   ← adaptador catalog→modelo + store append-only
├── App.vue         ← lista + detalle + filtros
└── components/
    ├── FieldPreview.vue   ← render del campo (text / checkbox / consentimiento / table)
    └── AddFieldModal.vue
```

## Si esto madura

El siguiente paso natural sería que este catálogo deje de ser exclusivo del PDF
Mapper y sea un **registro de campos** que otras lógicas consuman con la misma
semántica append/deprecate. Ver los nodos de contexto `form-service` y `dynamic-forms`
(el EAV `user_field_values` es el otro gran consumidor del "id de campo").
