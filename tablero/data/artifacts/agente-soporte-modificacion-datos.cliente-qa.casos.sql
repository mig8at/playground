-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- El cliente de prueba del canal de soporte — UNO solo, con dos comercios
--
-- Deja al cliente que usa `agente-soporte-modificacion-datos.cliente-qa.html` en su estado inicial: **dos créditos gestionables en
-- comercios distintos**. Con dos alcanza para todo lo que hay que probar —el menú de elegir crédito, el
-- cambio de fecha y el de plazo— y con uno solo no se vería el menú.
--
-- **Correr esto otra vez ES el reset.** Borra sus cambios anteriores y vuelve a dejar los dos créditos
-- como al principio, así que se puede probar las veces que haga falta. Eso resuelve la regla que más
-- estorba al probar: un crédito al que se le cambió algo **no admite otro cambio por 6 meses**.
--
-- ⚠ ESCRIBE. Contra local o dev; **nunca contra producción**.
--
--     # local
--     docker exec -i -e MYSQL_PWD=password legacy-backend-mysql-1 mysql -uroot creditop < agente-soporte-modificacion-datos.cliente-qa.casos.sql
--
--     # dev — host, usuario y base salen de trazador/.env.dev
--     mysql -h <E2E_DB_HOST> -u <E2E_DB_USER> -p <E2E_DB_NAME> < agente-soporte-modificacion-datos.cliente-qa.casos.sql
--
-- Lo que solo toca de la base es este cliente y sus solicitudes con el lender `qa-soporte-lender`.
-- No hay ningún DELETE sin filtrar.
--
-- Por qué cada cosa es como es — esto es lo que costó descubrir:
--
--  1. **El celular tiene que estar en `settings.qa_otp_bypass_phones`.** Con el bypass el proveedor no
--     se llama y el código del OTP son los **últimos 4 dígitos** del celular. Sin eso, cada prueba le
--     manda un SMS de verdad a quien sea dueño de ese número. Si cambiás el celular, agregá el nuevo
--     a esa lista — y comprobá que no sea ya de otro cliente (ver el punto 6).
--
--  2. **`first_name` no puede ser `TEMPORAL USER`.** La búsqueda por WhatsApp excluye ese nombre —es
--     el placeholder de los registros a medio hacer—, así que un cliente sembrado así da 404 y parece
--     que el canal está roto.
--
--  3. **El lender tiene que ser `response_type = 2`** («Creditop X»): son los únicos créditos que
--     administra CreditOp, y por lo tanto los únicos gestionables desde el canal.
--
--  4. **`next_payment_amount = 0`** es la condición de «no tiene cuota por pagar». Con cualquier valor
--     mayor, el backend contesta `HAS_PENDING_PAYMENT` y no deja cambiar nada. ⚠ No es la mora: un
--     crédito con `days_past_due = 0` y esta columna en 50.000 también se rechaza.
--
--  5. **`next_payment_date` en el futuro.** Con la fecha vencida el menú de fechas se comporta distinto
--     (F-148) y deja de ser el caso limpio.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- ⚠ Sin esto los nombres con acento entran mal: el cliente `mysql` asume latin1 y «Mueblería» queda
-- como «MueblerÃ­a» en el menú del chat. Medido el 2026-08-20 corriendo el script sin esta línea.
-- Y con la collation de las columnas (`utf8mb4_unicode_ci`): sin declararla, la conexión usa
-- `utf8mb4_0900_ai_ci` y cualquier comparación de texto contra una columna tira
-- «Illegal mix of collations».
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- El celular tiene que estar en la lista de bypass Y NO ESTAR USADO por otro cliente. `3108000011`
-- cumple las dos cosas en local y en dev (medido el 2026-08-20).
--
-- ⚠ Esto se aprendió por las malas: la primera versión usaba `3131010100`, que en dev es de **JOHN
-- SMITH** — y como el script identificaba al cliente por el celular, le habría pisado el nombre y la
-- cédula a un usuario de prueba de otra persona. Por eso ahora la identidad es la CÉDULA (ver más
-- abajo): es un valor inventado para esto, así que no puede chocar con nadie.
SET @CEL         = '3108000011';          -- bypass de QA → no se manda ningún SMS. Código: 0011
SET @DOC         = '900000001';
SET @LENDER_SLUG = 'qa-soporte-lender';

-- ── 0 · el lender de pruebas (rt=2) y los dos comercios. Se reusan si ya existen ──────────────────
-- `paths` y `promissory_types` tienen FK con default 1 y en un esquema recién migrado están vacíos: sin
-- estas dos filas el insert del lender falla por integridad referencial, no por la regla que se prueba.
INSERT IGNORE INTO paths (id, name) VALUES (1, 'QA');
INSERT IGNORE INTO promissory_types (id, name) VALUES (1, 'QA');

INSERT INTO lenders (name, slug, response_type, created_at, updated_at)
SELECT 'QA Soporte (rt=2)', @LENDER_SLUG, 2, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM lenders WHERE slug = @LENDER_SLUG);
SET @LENDER = (SELECT id FROM lenders WHERE slug = @LENDER_SLUG LIMIT 1);

-- El nombre del comercio es lo que el cliente reconoce en el menú: es el título de cada fila.
--
-- ⚠ `allieds` exige `slug` y `allied_caterogy_id` —así, con el typo, que está en el esquema real— y esa
-- categoría tiene que existir. Se toma la primera que haya, y si la tabla está vacía se crea una:
-- `allied_categories` también pide colores y descripción sin default.
INSERT INTO allied_categories (name, slug, description, primary_color, secondary_color, created_at, updated_at)
SELECT 'General', 'general', 'QA', '#000000', '#ffffff', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM allied_categories);
SET @CAT = (SELECT MIN(id) FROM allied_categories);

INSERT INTO allieds (name, slug, allied_caterogy_id, created_at, updated_at)
SELECT 'Mueblería QA', 'muebleria-qa', @CAT, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM allieds WHERE name = 'Mueblería QA');
INSERT INTO allieds (name, slug, allied_caterogy_id, created_at, updated_at)
SELECT 'Tecno QA', 'tecno-qa', @CAT, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM allieds WHERE name = 'Tecno QA');
SET @ALLIED_A = (SELECT id FROM allieds WHERE name = 'Mueblería QA' LIMIT 1);
SET @ALLIED_B = (SELECT id FROM allieds WHERE name = 'Tecno QA'     LIMIT 1);

-- ── 1 · el cliente, identificado por su CÉDULA ────────────────────────────────────────────────────
-- La identidad es `document_number`, no el celular, y es lo que hace que este script sea seguro de
-- correr: `@DOC` es un valor inventado para estas pruebas, así que sólo puede existir el usuario que
-- este mismo script creó. Buscando por celular, en cambio, un número que ya sea de otro cliente de QA
-- terminaría con su nombre y su cédula reescritos sin que nadie se enterara.
--
-- `user_profile_id = 1` es cliente. El password es un hash cualquiera: este usuario no inicia sesión,
-- entra por su número de WhatsApp.
INSERT INTO users (first_name, surname, document_number, document_type, cell_phone, user_profile_id, password, created_at, updated_at)
SELECT 'ANA QA', 'PRUEBAS', @DOC, 1, @CEL, 1, '$2y$10$qaqaqaqaqaqaqaqaqaqaqa', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE document_number = @DOC);

SET @U = (SELECT id FROM users WHERE document_number = @DOC ORDER BY id DESC LIMIT 1);

-- Se normaliza sólo ESE usuario (el de la cédula de pruebas), nunca uno ajeno.
UPDATE users SET first_name = 'ANA QA', surname = 'PRUEBAS', cell_phone = @CEL, user_profile_id = 1
 WHERE id = @U;

-- ── 2 · el RESET: se borra lo que dejaron las corridas anteriores ─────────────────────────────────
-- El orden importa por las llaves: primero el log de cambios y el ledger, después las solicitudes.
-- Y esto es lo que permite volver a probar: sin borrar `creditop_x_changes_log`, la regla de los 6
-- meses rechaza el segundo cambio sobre el mismo crédito.
DELETE ch FROM creditop_x_changes_log ch
  JOIN user_requests ur ON ur.id = ch.user_request_id
 WHERE ur.user_id = @U AND ur.lender_id = @LENDER;
DELETE h FROM creditop_x_requests_history h
  JOIN user_requests ur ON ur.id = h.user_request_id
 WHERE ur.user_id = @U AND ur.lender_id = @LENDER;
DELETE FROM user_requests WHERE user_id = @U AND lender_id = @LENDER;

-- Y la sesión del canal, para que la prueba arranque pidiendo el código y no «ya estabas verificado».
DELETE FROM support_bot_sessions WHERE wa_id = CONCAT('whatsapp:+57', @CEL);

-- ── 3 · sus dos créditos, en comercios distintos ──────────────────────────────────────────────────
-- `user_request_status_id = 11` es «Autorizada»: ya se desembolsó, que es la condición para que haya
-- algo que gestionar. `fee_number` es el plazo actual, y se dejan distintos a propósito para que en el
-- menú de plazos se vea que cada crédito ofrece lo suyo.
INSERT INTO user_requests (user_id, allied_id, lender_id, credit_line_id, user_request_status_id, fee_number, amount, created_at, updated_at)
VALUES (@U, @ALLIED_A, @LENDER, 1, 11, 12, 3000000, NOW(), NOW());
SET @UR_A = LAST_INSERT_ID();

INSERT INTO user_requests (user_id, allied_id, lender_id, credit_line_id, user_request_status_id, fee_number, amount, created_at, updated_at)
VALUES (@U, @ALLIED_B, @LENDER, 1, 11, 6, 1200000, NOW(), NOW());
SET @UR_B = LAST_INSERT_ID();

-- ── 4 · el ledger: la fila VIVA de cada crédito ───────────────────────────────────────────────────
-- `status = 1` es la fila vigente — el saldo de un crédito es siempre ésa, nunca la última por fecha
-- (ver el nodo `servicing`). Van las 24 columnas obligatorias; las que no cuentan para esto, en cero.
INSERT INTO creditop_x_requests_history
  (user_id, user_request_id, creditop_x_requests_status_id, status,
   next_payment_date, next_billing_date, installment_number, installment_value,
   principal_amount_balance, interest_amount_balance, insurance_amount_balance, total_payment_amount,
   paid_principal_amount, paid_interest, next_payment_amount, next_payment_principal,
   next_payment_interest, next_payment_insurance, installment_principal_value,
   installment_interest_value, life_insurance_per_month, late_payment_interest_value,
   days_past_due, billing_principal_amount, billing_day, daily_interest, created_at, updated_at)
VALUES
  -- Mueblería QA · 12 cuotas, va en la 1
  (@U, @UR_A, 1, 1, DATE_ADD(CURDATE(), INTERVAL 25 DAY), DATE_ADD(CURDATE(), INTERVAL 15 DAY),
   1, 250000, 2750000, 0, 0, 3000000, 250000, 0, 0, 0,
   0, 0, 250000, 0, 0, 0, 0, 0, 5, 0, NOW(), NOW()),
  -- Tecno QA · 6 cuotas, va en la 2
  (@U, @UR_B, 1, 1, DATE_ADD(CURDATE(), INTERVAL 25 DAY), DATE_ADD(CURDATE(), INTERVAL 15 DAY),
   2, 200000, 800000, 0, 0, 1200000, 400000, 0, 0, 0,
   0, 0, 200000, 0, 0, 0, 0, 0, 16, 0, NOW(), NOW());

-- ── 5 · qué quedó listo para probar ───────────────────────────────────────────────────────────────
SELECT u.cell_phone                AS celular,
       RIGHT(u.cell_phone, 4)      AS codigo_otp,
       u.document_number           AS cedula,
       u.first_name                AS nombre,
       ur.id                       AS user_request_id,
       a.name                      AS comercio,
       ur.fee_number               AS plazo_actual,
       DATE(h.next_payment_date)   AS proxima_fecha,
       h.next_payment_amount       AS cuota_pendiente
  FROM users u
  JOIN user_requests ur ON ur.user_id = u.id AND ur.lender_id = @LENDER
  JOIN creditop_x_requests_history h ON h.user_request_id = ur.id AND h.status = 1
  LEFT JOIN allieds a ON a.id = ur.allied_id
 WHERE u.id = @U
 ORDER BY ur.id;

-- ── 6 · el chequeo que evita una tarde perdida ─────────────────────────────────────────────────────
-- `findByWhatsApp` resuelve el cliente con un `first()`: si dos clientes comparten el celular, el canal
-- puede atender al OTRO y el chat contestaría «no encontramos una cuenta con esos datos» aunque el
-- cliente de prueba exista. Si esta consulta devuelve algo, hay que liberar el número o cambiar @CEL.
SELECT CONCAT('⚠ el celular ', @CEL, ' lo comparten ', COUNT(*), ' clientes: ',
              GROUP_CONCAT(CONCAT(first_name, ' / ', document_number) SEPARATOR ' · ')) AS conflicto
  FROM users
 WHERE cell_phone = @CEL AND user_profile_id = 1
HAVING COUNT(*) > 1;
