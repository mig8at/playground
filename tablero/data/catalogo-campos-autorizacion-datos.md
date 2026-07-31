---
id: 10
title: "Catálogo global de campos — nuevo campo de autorización de datos (habeas data + perfilamiento) y catálogo idéntico en dev y prod"
stage: tasks
created: "2026-07-24T13:39:41-05:00"
archived: "2026-07-24T13:46:59-05:00"
context_nodes: []
jira: []
jira_title: "Catálogo de campos: nuevo campo de autorización de tratamiento de datos y catálogo unificado entre ambientes"
---

Sesión 2026-07-24.

Campo nuevo: data_processing_consent (checkbox, options ['accepted'], defaultValue 'accepted') = "Autorización tratamiento de datos personales (incl. perfilamiento crediticio)". Modela un checkbox de casilla única.

1) Seed del editor (pdf-mapper-editor/src/store/useEditorStore.ts): agregado a DEFAULT_CATALOG_FIELDS, DEFAULTS_VERSION 8→9 → mergeMissingDefaults lo inyecta al recargar. (Commit 9fbee89.)
2) Catálogo vivo (S3, _catalog.json) unificado vía PUT /api/fields a dev Y prod: quedaron idénticos en 128 campos. dev estaba corto 2 (country, fianza_amount_iva) y 3 labels drifteados (pep_public_power, pep_public_funds, relationship_type) reconciliados a la definición canónica (dev/seed). Verificado: dev==prod campo a campo.

Validado que ningún consumidor rompe: el catálogo NO lo usa /generate (mapper autocontenido), solo /example y la autoría del editor.

## Tarea (publicable)

Sobre el catálogo global de campos que consume el mapeo de documentos:

- Nuevo campo: autorización de tratamiento de datos personales (incluye perfilamiento crediticio), como casilla de aceptación. Cubre el consentimiento de habeas data del onboarding.

- Paridad entre ambientes: el catálogo quedó idéntico en desarrollo y producción (mismos campos y definiciones). Antes había diferencias entre ambos; se reconciliaron a la definición vigente.

Verificado que el catálogo es idéntico en los dos ambientes.
