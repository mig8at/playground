-- Banco Finandina (149) como entidad del riel 4 (originación delegada) en la base LOCAL, sobre el comercio
-- «Finandina Pruebas» que siembra `make harness-merchant MERCHANT=finandina` (slug finandina-pruebas).
-- Los valores son los de la política de agosto 2026 que ya están decididos; lo que espera a producto va
-- marcado (PROVISIONAL).
-- Correr con: docker exec -i legacy-backend-mysql-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" creditop' < este.sql
-- La credencial va cifrada con la llave de la app, así que se crea aparte, en legacy-backend:
--   ./vendor/bin/sail artisan tinker --execute="\$c = new App\Models\LenderAlliedCredential; \$c->forceFill(['lender_id'=>149,'allied_type'=>App\Models\Allied::class,'allied_id'=>App\Models\Allied::where('slug','finandina-pruebas')->value('id'),'credential'=>['finandina_local'=>'sin-uso']])->save();"
-- Y una credencial de Deceval de PRUEBA para la entidad (sin ella el pagaré da 500: `createGirador` recibe null).
-- En local Deceval lo atiende el mock del harness (:8106); el certificado es uno autofirmado que se genera y se borra:
--   mkdir -p storage/app/tmp-finandina && openssl req -x509 -newkey rsa:2048 -nodes -keyout storage/app/tmp-finandina/key.pem -out storage/app/tmp-finandina/cert.pem -days 365 -subj '/CN=Finandina local/O=PRUEBA'
--   ./vendor/bin/sail artisan tinker --execute='$c = new App\Models\RiskCentralCredential; $c->forceFill(["risk_central_id"=>App\Models\RiskCentral::where("name","Deceval")->value("id"),"credentialable_type"=>App\Models\Lender::class,"credentialable_id"=>149,"credential"=>["deceval_cert"=>file_get_contents(storage_path("app/tmp-finandina/cert.pem")),"deceval_key"=>file_get_contents(storage_path("app/tmp-finandina/key.pem")),"deceval_username"=>"finandina-local","deceval_password"=>"finandina-local","deceval_nit_emisor"=>"860051894","deceval_nit_user"=>"860051894","deceval_depositante"=>"0000","deceval_clase_documento"=>"1"]])->save();'
--   rm -rf storage/app/tmp-finandina
-- Deshacer: borrar las filas de lender_id=149 de delegated_origination_profiles, lenders_by_allieds,
-- lenders_by_allied_branches, lender_identity_validation_types, lender_datacredito_rules y
-- lender_allied_credentials, y volver lenders y la línea a lo de antes:
--   UPDATE lenders SET response_type=1, promissory_type_id=1, validation_type=1, document_types='["CC", "CE"]' WHERE id=149;
--   UPDATE credit_line_by_lenders SET rate=1.83, fee_numbers='3,6,12,18,24,36,48,60', min_fee_number=3, max_fee_number=60, min_amount=1000000, max_amount=20000000 WHERE lender_id=149;
START TRANSACTION;
SET @allied := (SELECT id FROM allieds WHERE slug='finandina-pruebas');

-- Riel 4, pagaré Deceval (2), validación como Credifamilia, sólo cédula. Sin proveedor de firma.
UPDATE lenders SET response_type=4, promissory_type_id=2, validation_type=2, document_types='["CC"]',
       signing_provider_id=NULL, updated_at=NOW() WHERE id=149;

-- Línea: 3–15 MM, 6–36 meses. Tasa 1,79 % N.M., la de modelación del PRD (PROVISIONAL: se actualiza cada mes).
UPDATE credit_line_by_lenders SET rate=1.79, rate_suffix='N.M.', fee_numbers='6,12,18,24,36', min_fee_number=6,
       max_fee_number=36, min_amount=3000000, max_amount=15000000, updated_at=NOW() WHERE lender_id=149;

-- Convenio con el comercio: seguro de vida 1.660 por millón; FGA 9 % (el de score < 856; el 5 % con score ≥ 856
-- todavía no tiene dónde vivir en el riel). Se clona la fila de Credifamilia en su comercio 24 por sus columnas
-- NOT NULL, y se pisa la plata.
INSERT INTO lenders_by_allieds (`lender_id`,`allied_id`,`url_utm`,`confirmation_emails`,`expense_penalties_percentage`,`administrative_costs_percentage`,`life_insurance_percentage`,`life_insurance_fixed`,`guarantee_fund_percentage`,`iva`,`multiple_of_maximum_amount`,`sort`,`user_self_management`,`hide_probability`,`initial_fee_percentage`,`guarantee_fixed_monthly_percentage`,`insurance_fixed_monthly_percentage`,`guarantee_insurance_per_million`,`insurance_percentage_per_million`,`administrative_fixed_value`,`origination_cost_fixed`,`bank_id`,`comission_percentage`,`credit_note_calculation_id`,`starting_value_calculation_id`,`min_amount`,`max_amount`,`min_initial_fee`,`min_product_amount`,`enable_collection`,`status`,`created_at`,`updated_at`)
SELECT 149,@allied,NULL,`confirmation_emails`,0,0,0,0,9,`iva`,`multiple_of_maximum_amount`,1,0,`hide_probability`,0,0,0,0,1660,0,0,`bank_id`,0,`credit_note_calculation_id`,`starting_value_calculation_id`,3000000,15000000,0,0,`enable_collection`,1,NOW(),NOW()
FROM lenders_by_allieds WHERE lender_id=24 AND allied_id=24;

INSERT INTO lenders_by_allied_branches (`lender_id`,`document_types`,`allied_branch_id`,`url_utm`,`sort`,`status`,`created_at`,`updated_at`)
SELECT 149,'["CC"]',id,NULL,1,1,NOW(),NOW() FROM allied_branches WHERE allied_id=@allied;

-- Identidad: los mismos proveedores que Credifamilia (ADO primero).
INSERT INTO lender_identity_validation_types (`lender_id`,`identity_validation_type_id`,`order`,`status`,`created_at`,`updated_at`)
SELECT 149,`identity_validation_type_id`,`order`,`status`,NOW(),NOW() FROM lender_identity_validation_types WHERE lender_id=24;

-- Buró: score 646 y se acepta score 0 (política de agosto). El resto, como Credifamilia.
INSERT INTO lender_datacredito_rules (`allied_branch_id`,`lender_id`,`score`,`allow_0_score`,`current_dues`,`time_finance_sector`,`negative_historical_last_12_months`,`consulted_last_6_months`,`probability_levels`,`created_at`,`updated_at`)
SELECT NULL,149,646,1,`current_dues`,`time_finance_sector`,`negative_historical_last_12_months`,`consulted_last_6_months`,`probability_levels`,NOW(),NOW()
FROM lender_datacredito_rules WHERE lender_id=24 AND allied_branch_id IS NULL;

-- El perfil del riel. Días 5/10/15/20 de sus T&C (PROVISIONAL), fianza del preaprobado y anticipada, sin 4x1000,
-- insumos de la configuración de la entidad y sin formalización (llega a 11 sin radicar).
INSERT INTO delegated_origination_profiles (`lender_id`,`bond_percentage_source`,`forced_bond_type`,`applies_four_per_thousand`,`payment_days`,`inputs_source`,`formalization`,`created_at`,`updated_at`)
VALUES (149,'pre_approval','Anticipada',0,'[5, 10, 15, 20]','lender_configuration',NULL,NOW(),NOW());
COMMIT;

-- Reglas duras de la política, en plantilla y en una regla de grupo de la sucursal. ⚠ Sin al menos una regla de
-- grupo en la sucursal, el listado NO devuelve la entidad: `validateRulesByLender` sólo agrega las que tienen
-- reglas ahí. En el riel 4 una regla que falla no la saca: la deja con «Probabilidad muy baja».
-- Ingreso ≥ 1 SMMLV en pesos (PROVISIONAL: 1.423.500, el de 2025; hay que actualizarlo cada año).
START TRANSACTION;
INSERT INTO group_rules (`allied_branch_id`,`rule_name`,`created_at`,`updated_at`)
SELECT id, CONCAT('AB', id), NOW(), NOW() FROM allied_branches WHERE allied_id=(SELECT id FROM allieds WHERE slug='finandina-pruebas');
SET @group := LAST_INSERT_ID();
INSERT INTO lender_rules (`group_rule_id`,`lender_id`,`name`,`description`,`field_id`,`specific_table`,`column`,`operator`,`value`,`status`,`created_at`,`updated_at`) VALUES
 (NULL,149,'edad minima','Finandina: 21 años',NULL,'users','age','>=','21',1,NOW(),NOW()),
 (NULL,149,'edad maxima','Finandina: 64 años',NULL,'users','age','<=','64',1,NOW(),NOW()),
 (NULL,149,'ocupacion','Finandina: empleados y pensionados',29,NULL,NULL,'=','Empleado|Pensionado',1,NOW(),NOW()),
 (NULL,149,'ingresos mensuales','Finandina: 1 SMMLV',87,NULL,NULL,'>=','1423500',1,NOW(),NOW());
INSERT INTO lender_rules (`group_rule_id`,`lender_id`,`name`,`description`,`field_id`,`specific_table`,`column`,`operator`,`value`,`status`,`created_at`,`updated_at`)
SELECT @group,149,`name`,`description`,`field_id`,`specific_table`,`column`,`operator`,`value`,`status`,NOW(),NOW() FROM lender_rules WHERE lender_id=149 AND group_rule_id IS NULL;
COMMIT;
-- Deshacer las reglas: DELETE FROM lender_rules WHERE lender_id=149; y la regla de grupo de la sucursal.
