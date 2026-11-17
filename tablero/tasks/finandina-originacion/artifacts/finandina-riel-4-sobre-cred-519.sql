-- Banco Finandina (149) por el riel 4 (originación delegada) con la política de CRED-519 (2026-11-17).
-- Supone la 149 ya configurada como la dejó CRED-519 (perfiles, reglas, línea, zonas y formulario 25).
-- Cambia sólo el riel: tipo 4, pagaré digital y su perfil de originación delegada con la fuente de insumos
-- `creditop_x_pre_approval` (el cupo lo decide el motor de CreditopX por la preaprobación).
-- Antes de aplicar, la foto: SELECT id,response_type,promissory_type_id,validation_type,signing_provider_id FROM lenders WHERE id=149;
--                            SELECT * FROM delegated_origination_profiles WHERE lender_id=149;
-- Deshacer (volver a lo de CRED-519):
--   UPDATE lenders SET response_type=2, promissory_type_id=1, validation_type=1 WHERE id=149;
--   DELETE FROM delegated_origination_profiles WHERE lender_id=149;
UPDATE lenders SET response_type=4, promissory_type_id=2, validation_type=2, updated_at=NOW() WHERE id=149;
INSERT INTO delegated_origination_profiles (lender_id, bond_percentage_source, forced_bond_type, applies_four_per_thousand, payment_days, inputs_source, formalization, created_at, updated_at)
VALUES (149, 'pre_approval', 'Anticipada', 0, '[5, 10, 15, 20]', 'creditop_x_pre_approval', NULL, NOW(), NOW())
ON DUPLICATE KEY UPDATE bond_percentage_source=VALUES(bond_percentage_source), forced_bond_type=VALUES(forced_bond_type),
  applies_four_per_thousand=VALUES(applies_four_per_thousand), payment_days=VALUES(payment_days),
  inputs_source=VALUES(inputs_source), formalization=VALUES(formalization), updated_at=NOW();
