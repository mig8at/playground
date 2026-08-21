-- Andamiaje para probar el canal de soporte COMPLETO en local — CORE-258.
--
-- El `.cliente-qa.casos.sql` crea al CLIENTE y alcanza para la autogestión. Este agrega lo que
-- falta para el resto, y cada bloque existe porque su ausencia rompía una prueba concreta:
--
--   1. el celular de ANA QA en el bypass de QA — el .sql del cliente lo DA POR HECHO, y en la
--      base local no estaba (medido el 2026-08-21). Sin eso el proveedor de SMS se llama de verdad.
--   2. un ASESOR con los dos comercios de ANA QA — sin él no hay flujo de asesor que probar.
--   3. la LÍNEA DE CRÉDITO del lender de QA — sin `fee_numbers`, `simulatePossibleFees` corta en
--      seco y la rama del plazo devuelve el menú vacío, que parece un bug y no lo es.
--   4. un crédito con lender rt=4 — para comprobar la guarda `CREDIT_NOT_SERVICED_BY_US`, que
--      existe porque una prueba en local llegó a cambiarle fecha y plazo a créditos de Credifamilia.
--
-- ⚠ Ojo con el reset: correr el .sql del cliente otra vez NO restaura las solicitudes, las
--   RECREA con ids nuevos. Los ids de una corrida anterior dejan de existir.
--
-- Correr DESPUÉS del .sql del cliente:
--   docker exec -i -e MYSQL_PWD=password legacy-backend-mysql-1 mysql -uroot creditop < <este archivo>


SET @CEL_ASESOR = '3108000012';
SET @DOC_ASESOR = '900000002';

-- 1 · Los dos celulares en el bypass de QA: sin esto el proveedor se llama de verdad.
--     El de ANA QA (3108000011) NO estaba en la lista local, aunque el .sql del cliente lo asume.
UPDATE settings
   SET value = JSON_ARRAY_APPEND(
                 JSON_ARRAY_APPEND(value, '$', CAST('3108000011' AS UNSIGNED)),
                 '$', CAST(@CEL_ASESOR AS UNSIGNED))
 WHERE `key` = 'qa_otp_bypass_phones'
   AND value NOT LIKE '%3108000011%';

-- 2 · El asesor. `user_profile_id = 7` (Admin comercio) — cualquiera que no sea 1 sirve; lo que
--     de verdad lo hace asesor es tener comercios: allied_id + multiple_allieds cubren los dos de ANA QA.
INSERT INTO users (first_name, surname, document_number, document_type, cell_phone, user_profile_id,
                   allied_id, multiple_allieds, password, created_at, updated_at)
SELECT 'CARO', 'ASESORA QA', @DOC_ASESOR, 1, @CEL_ASESOR, 7, 277, '[278]', 'x', NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE document_number = @DOC_ASESOR);

UPDATE users
   SET cell_phone = @CEL_ASESOR, user_profile_id = 7, allied_id = 277, multiple_allieds = '[278]',
       first_name = 'CARO', surname = 'ASESORA QA'
 WHERE document_number = @DOC_ASESOR;

SELECT id, first_name, cell_phone, document_number, user_profile_id, allied_id, multiple_allieds
  FROM users WHERE document_number = @DOC_ASESOR;
SELECT value LIKE '%3108000011%' AS ana_ok, value LIKE '%3108000012%' AS asesora_ok
  FROM settings WHERE `key` = 'qa_otp_bypass_phones';

SET @LENDER = (SELECT id FROM lenders WHERE slug = 'qa-soporte-lender');

INSERT INTO credit_line_by_lenders
  (credit_line_id, lender_id, min_fee_number, max_fee_number, fee_numbers, fee_interval,
   rate, rate_suffix, min_amount, max_amount, fee_name, sort, status, created_at, updated_at)
SELECT 1, @LENDER, 3, 24, '3,6,9,12,18,24', 3, 2.00, 'N.M.', 100000, 20000000, 'meses', 1, 1, NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM credit_line_by_lenders WHERE lender_id = @LENDER);

-- La tasa vive en la SOLICITUD (`user_requests.rate`); en NULL, la simulación calcula sin interés.
UPDATE user_requests SET rate = 2.00 WHERE user_id = 1828929 AND rate IS NULL;

SELECT ur.id, ur.fee_number, ur.rate, cl.fee_numbers
  FROM user_requests ur JOIN credit_line_by_lenders cl ON cl.lender_id = ur.lender_id
 WHERE ur.user_id = 1828929;

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO lenders (name, slug, response_type, created_at, updated_at)
SELECT 'QA Externo (rt=4)', 'qa-externo-lender', 4, NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM lenders WHERE slug='qa-externo-lender');
SET @LENDER4 = (SELECT id FROM lenders WHERE slug='qa-externo-lender');

CREATE TEMPORARY TABLE t_ur AS SELECT * FROM user_requests WHERE id = 465007;
UPDATE t_ur SET id = 0, lender_id = @LENDER4;
INSERT INTO user_requests SELECT * FROM t_ur;
SET @UREQ4 = LAST_INSERT_ID();

CREATE TEMPORARY TABLE t_h AS
  SELECT * FROM creditop_x_requests_history WHERE user_request_id = 465007 AND status = 1 LIMIT 1;
UPDATE t_h SET id = 0, user_request_id = @UREQ4, next_payment_amount = 0;
INSERT INTO creditop_x_requests_history SELECT * FROM t_h;

SELECT @UREQ4 AS ureq_rt4, l.name, l.response_type
  FROM lenders l WHERE l.id = @LENDER4;
