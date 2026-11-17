-- Formulario de residencia de Finandina (25) en la base LOCAL, como está en qa (2026-11-17).
-- Lo pide la etapa extendida de CRED-519: sin departamento y ciudad de residencia, rechaza.
-- El esquema lo sirve el mock de form-service (harness/mock-forms-g2/fixtures/esquema-25.json).
-- Deshacer: DELETE FROM dynamic_form_placements WHERE scope_type='lender' AND scope_id=149 AND form_type_id=25;
--           DELETE FROM form_types WHERE id=25;
INSERT INTO form_types (id, name, description, lender_id, status, created_at, updated_at)
VALUES (25, 'finandina-creditop-x-additional-info', 'formulario dinámico de finandina para creditop x (additional info)', 149, 1, NOW(), NOW());
INSERT INTO dynamic_form_placements (scope_type, scope_id, credit_line_id, placement, form_type_id, sort, is_enabled, always_show, created_at, updated_at)
VALUES ('lender', 149, 1, 'post_lender_selection', 25, 1, 1, 0, NOW(), NOW());
