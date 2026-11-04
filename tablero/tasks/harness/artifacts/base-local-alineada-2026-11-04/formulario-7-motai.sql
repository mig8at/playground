-- Formulario 7 «motai-renting» y sus ubicaciones, como en producción (medido el 2026-11-04).
-- Producción: form_types 7 (lender 158); dynamic_form_placements 1 (158 post_lender_selection, activa),
-- 2 (193 post_lender_selection, activa) y 3 (158 pre_sign_documents, apagada). En local la 193 es la 173.
INSERT INTO form_types (id, name, description, lender_id, status, created_at, updated_at)
VALUES (7, 'motai-renting', 'formulario incial de motai renting', 158, 1, NOW(), NOW());
INSERT INTO dynamic_form_placements (scope_type, scope_id, credit_line_id, placement, form_type_id, sort, is_enabled, always_show, created_at, updated_at) VALUES
  ('lender', 158, 1, 'post_lender_selection', 7, 1, 1, 0, NOW(), NOW()),
  ('lender', 173, 1, 'post_lender_selection', 7, 1, 1, 0, NOW(), NOW()),
  ('lender', 158, 1, 'pre_sign_documents',    7, 1, 0, 0, NOW(), NOW());
-- Para deshacerlo:
--   DELETE FROM dynamic_form_placements WHERE form_type_id = 7 AND scope_type = 'lender' AND scope_id IN (158, 173);
--   DELETE FROM form_types WHERE id = 7;
