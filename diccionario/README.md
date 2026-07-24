# diccionario — prototipo de catálogo global de campos

Prototipo (Vue 3 + Vite) para explorar la idea de **un solo diccionario de ids de
campos** compartido entre varias lógicas de CreditOp (hoy: el **PDF Mapper** y el
**form dinámico** `backend-driven-form`; mañana, lo que venga).

No es producción ni pega contra ningún backend: es un espacio para ver y discutir
la forma. El estado vive en memoria + `localStorage` (botón ↺ restaura la semilla).

## La idea que prototipa

Salió de la charla sobre "hacer seguro el catálogo del PDF Mapper". Tres decisiones
que queremos ver funcionando:

1. **Un solo diccionario (una fuente de verdad).** El mismo id (`city`,
   `first_name`, `data_processing_consent`) es *el mismo campo* en todos lados.
2. **Core común + extensiones por consumidor.** El **core** (`id`, `type`,
   `label`, `options`) es lo compartible. Cada **consumidor** le cuelga su propia
   metadata sin ensuciar el core ni al resto:
   - *PDF Mapper* → `defaultValue` (valor de ejemplo para la preview).
   - *Form dinámico* → `required`, `dataSource` (ej. `country_tree`),
     `relatedFieldId` (cascada depto→ciudad), `validation`.
   Así evitamos el "schema obeso" que no le sirve bien a nadie.
3. **Append-only (seguro por construcción).** Se **agrega** y se **depreca**
   (reversible); **nunca** se edita in-place ni se borra. Si no podés mutar/eliminar
   una definición, no podés romper los documentos/formularios que ya la usan.
   Deprecar no destruye: el campo sigue resolviendo `type`/`label` para lo viejo,
   pero deja de ofrecerse para lo nuevo.

## Qué se ve

- Lista del diccionario con búsqueda, filtro por consumidor y toggle de obsoletos.
- Detalle de cada campo: core + una tarjeta por consumidor (su metadata o "no lo usa").
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
├── dictionary.ts   ← modelo (core + extensiones) + store append-only + semilla
├── App.vue         ← lista + detalle + filtros
└── components/AddFieldModal.vue
```

## Si esto madura

El siguiente paso natural sería extraer un **servicio de registro de campos** que
tanto el PDF Mapper como el `form-service` consuman (en vez de que uno dependa del
otro), con la misma semántica append/deprecate y cacheo del lado del cliente.
Ver la discusión en el chat / nodos de contexto de `form-service` y `pdf-mapper`.
