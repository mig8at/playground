---
id: 8
title: "Credifamilia — campo Ciudad de nacimiento en cascada (form dinámico G2)"
stage: tasks
created: "2026-07-23T15:46:04-05:00"
context_nodes: [form-service, dynamic-forms, credifamilia]
---

JIRA: CORE-301 (https://creditop.atlassian.net/browse/CORE-301) · Sprint 8 · En pruebas

FORM DINÁMICO G2 (backend-driven) de Credifamilia = form_type 6, servido por el MS Go form-service (VITE_FORM_SERVICE_BASE_URL, github/form-service). Respuestas → user_field_values (DELETE+INSERT, form_id=6).

GAP: "Departamento de nacimiento" (field 183) no tenía su "Ciudad" asociada — a diferencia de residencia (184/185), trabajo (194/195), empresa (201/202) y expedición CC (218/219).

FIX (cero código, solo data): clonar la gemela "Ciudad de residencia" (185) → nuevo field "Ciudad de nacimiento" con related_field_id=183, data_source='field_options.country_tree.zones.cities', linkeado en forms (form_type_id=6) en sort debajo del departamento.

MIGRACIÓN: legacy-backend, rama feat/credifamilia-add-ciudad-nacimiento-field (commit 925820c1, pusheada; PR pendiente). Archivo database/migrations/2026_07_23_193000_add_ciudad_de_nacimiento_field_to_credifamilia_form.php. Idempotente, resuelve por NOMBRE (ids difieren por ambiente: 233 dev, 221/222 local), reversible, no-op en BD fresca/CI. Probada local con artisan (up/down/idempotencia).

POST-DEPLOY OBLIGATORIO: PUT {form-service}/v1/dynamic-form/6/schema (cache-aside Redis/S3).

VALIDADO EN DEV: field 233 aplicado, GET/PUT schema + POST response OK (fila en user_field_values). Render + cascada verificados por el flow self-service con frontend-e2e/dev/credifamilia-form.spec.ts (elegir Antioquia pobló Ciudad con municipios de Antioquia).

HARNESS: bin/asesor ahora pasa VITE_FORM_SERVICE_BASE_URL; panel con pre-warm de sesiones al arrancar.
CONTEXTO: nodos form-service (nuevo) + dynamic-forms + credifamilia actualizados.
