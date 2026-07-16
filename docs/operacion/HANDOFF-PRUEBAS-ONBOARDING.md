# Handoff — probar el onboarding con comercios y clientes sintéticos

Guía para armar una herramienta de pruebas del **onboarding CreditOp**: elegir cualquier
**comercio**, asignárselo a un **asesor**, e insertar un **cliente con su buró (datacrédito)** ya
resuelto — para no depender del envío de OTP ni de la consulta real a centrales.

Está pensada para replicarse contra **dev** (necesitás **VPN** + credenciales de la DB dev + el
`APP_KEY` de dev). Incluye SQL + snippets en Python. Al final hay una arquitectura sugerida
(**server** de operaciones de DB + **frontend** panel), que es como lo tenemos nosotros en Node —
podés portarlo a Python.

> Implementación de referencia (Node, `playground/frontend-e2e/`): `pkg/asesor.ts` (assign),
> `pkg/inject.ts` (cliente + buró), `pkg/laravel-crypt.ts` (encriptación del buró),
> `panel/server.ts` + `panel/index.html` (server + frontend). Sirven como espejo 1:1.

---

## 0. Modelo mental (5 minutos)

**Jerarquía de config:**
```
Entidad (lender)  →  Comercio (allieds)  →  Sucursal (allied_branches, tiene `hash`)
                                              └─ qué lenders ofrece: lenders_by_allied_branches
Asesor  = fila users con cognito_id (el "sub" de Cognito), apuntada a UN allied_branch
Cliente = fila users SIN cognito_id (la crea el register al pasar teléfono/OTP)
Solicitud = user_requests (user_id + allied_branch_id + amount + lender_id + status)
```

**Etapas del wizard (la app `loan-request-wizard`):**
```
/solicitar (monto) → teléfono → OTP → personal-info (identidad/KYC) → /lenders (marketplace)
→ elegís lender → continuación / formalización
```

**Dónde entra el buró:** en el paso de identidad/estudio de crédito el backend consulta la central
(Experian) y guarda el resultado en `risk_central_user_data`. Después `/lenders` usa ese buró para
decidir qué entidades ofrecer (rt=2 in-platform, rt=1 integración externa, rt=0 estándar) y con qué cupo.

**La clave para las pruebas:** el backend **reusa un buró reciente (< 1 mes)** si ya existe. Así que si
**insertamos** la fila del buró ANTES de que el usuario llegue a personal-info, el backend NO vuelve a
consultar la central → probamos con datos controlados y sin OTP/consulta real.
(Guards en legacy: `OnboardingService::userHasDataCredito`, `CreditStudyService`.)

---

## 1. Conexión a la DB dev

- **VPN encendida** (el RDS de dev está en red privada; sin VPN, `connect ETIMEDOUT`).
- Credenciales: `host` (RDS `*.rds.amazonaws.com`), `port` 3306, `user`, `password`, `database`.
- **`APP_KEY` de dev**: necesario para **encriptar el `data` del buró** con el mismo formato que Laravel.
  Si no usás el APP_KEY correcto, el MAC no valida y legacy no puede desencriptar la fila.
- **connectTimeout largo** (~30 s): el RDS remoto tarda en el handshake; con el default (10 s) a veces
  da timeout aunque el TCP sí llegue.
- **Guarda:** dev es **DATA COMPARTIDA** (aliados + refactor + otros devs + staging). Toda escritura
  (assign, insert de cliente, buró) impacta a todos → poné una confirmación/flag explícito antes de escribir.

---

## 2. Parte A — Asignar un comercio a un asesor

Un asesor "pertenece" a un comercio/sucursal por estas columnas de su fila `users`:
`allied_id` (comercio), `allied_branch_id` (sucursal), `user_profile_id` (rol). Probar otro comercio =
re-apuntar esas columnas al comercio/sucursal deseado.

**2.1. Resolver comercio → sucursal (hash):**
```sql
SELECT ab.id AS branch_id, ab.hash, a.id AS allied_id, a.name, a.slug
FROM allied_branches ab
JOIN allieds a ON a.id = ab.allied_id
WHERE a.slug = 'motai' OR a.name LIKE '%motai%'
ORDER BY ab.id;
-- el `hash` es lo que va en la URL del wizard: /merchant/<hash>/solicitar
```
> Ojo: un comercio puede tener **varias sucursales**; los lenders/reglas se configuran **por sucursal**
> (`lenders_by_allied_branches`). Elegí la sucursal que tiene los lenders que querés probar:
> ```sql
> SELECT lba.lender_id, l.name, l.response_type AS rt
> FROM lenders_by_allied_branches lba JOIN lenders l ON l.id = lba.lender_id
> WHERE lba.allied_branch_id = :branch_id AND lba.status = 1;
> ```

**2.2. El asesor** es una fila `users` con `cognito_id` = el **sub** del token de Cognito del login web
(lo sacás del JWT del asesor o del panel de Cognito). Ver la asignación actual:
```sql
SELECT u.id, u.cognito_id, u.allied_id, u.allied_branch_id, ab.hash, a.name
FROM users u
LEFT JOIN allied_branches ab ON ab.id = u.allied_branch_id
LEFT JOIN allieds a ON a.id = u.allied_id
WHERE u.cognito_id = :sub;
```

**2.3. Asignar (re-apuntar):**
```sql
-- guardá antes allied_id/allied_branch_id/user_profile_id/cognito_id previos → para revertir
UPDATE users
SET allied_id = :allied_id, allied_branch_id = :branch_id,
    user_profile_id = :profile_id, status = 1, updated_at = NOW()
WHERE cognito_id = :sub;
```
Si el asesor todavía no tiene fila (`users` con ese `cognito_id`), se crea:
```sql
INSERT INTO users (cognito_id, first_name, surname, full_name, email, cell_phone,
    document_number, document_type, country_id, allied_id, allied_branch_id,
    user_profile_id, status, password, created_at, updated_at)
VALUES (:sub, 'ASESOR', 'PRUEBA', 'ASESOR PRUEBA', :email, :phone,
    :doc, 'CC', 1, :allied_id, :branch_id, :profile_id, 1, :placeholder_pass, NOW(), NOW());
```
> Revertir: volver a poner los valores previos (o borrar la fila si la creaste). Guardá un snapshot.

---

## 3. Parte B — Insertar un cliente con su buró

El cliente es una fila `users` que crea el `register` al pasar teléfono/OTP (los clientes tienen
`cognito_id` NULL). Sobre ESA fila "armamos el KYC": identidad + resumen + campos de ingreso + buró.

> Cómo obtener el `user_id` / `user_request_id`: el wizard crea el `user_request` al iniciar. Podés
> tomarlo del `MAX(id)` de `user_requests` de esa sucursal justo después de arrancar, o leerlo de la URL
> (`/merchant/<hash>/<user_request_id>/...`). De ahí sacás `user_id = user_requests.user_id`.

Se insertan/actualizan **4 cosas**:

**3.1. Identidad — `users`** (opcional si querés que la persona la cargue a mano en personal-info):
```sql
UPDATE users SET document_type='CC', document_number=:doc, first_name=:first, surname=:surname,
  full_name=:full, email=:email, date_of_birth='1990-01-01', expedition_date='2010-01-01',
  age=:age, gender='M', updated_at=NOW()
WHERE id=:user_id;
```

**3.2. Resumen — `user_summaries`** (empleo/ingreso + datacrédito):
```sql
-- agildata: JSON con empleo/ingreso. datacredito: JSON con { score, value_monthly_payment, data }
-- (data = perfil limpio: 0 negativos, pocas consultas, 1 TC con vector OK, deuda baja)
INSERT INTO user_summaries (user_id, agildata, datacredito, created_at, updated_at)
VALUES (:user_id, :agildata_json, :datacredito_json, NOW(), NOW())
ON DUPLICATE KEY UPDATE agildata=VALUES(agildata), datacredito=VALUES(datacredito), updated_at=NOW();
```

**3.3. Campos de ingreso — `user_field_values`** (form_id=1):
```
field_id 87  = ingreso mensual
field_id 29  = ocupación (Empleado | Independiente | Pensionado)
field_id 160 = reportado (no)
```
```sql
INSERT INTO user_field_values (field_id, user_id, user_request_id, form_id, value, status, created_at, updated_at)
VALUES (87, :user_id, :ur, 1, :income, 1, NOW(), NOW());  -- idem 29, 160
```

**3.4. El buró — `risk_central_user_data`** (la fila Experian; es lo que `/lenders` mira):
```sql
-- risk_central_id = el id de la central Experian:
SELECT id FROM risk_centrals
WHERE name IN ('Experian - Acierta+Quanto','Experian - Acierta')
ORDER BY FIELD(name,'Experian - Acierta+Quanto','Experian - Acierta') LIMIT 1;

DELETE FROM risk_central_user_data WHERE user_id=:user_id AND risk_central_id=:rc_id;
INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at)
VALUES (UUID(), :user_id, :rc_id, :score, :data_encriptado, NOW(), NOW());
```
- `score` va **plano**.
- `data` va **ENCRIPTADO con el formato de Laravel** (ver §4). Contiene el perfil del buró que la
  decisión lee (negativos 12m, consultas 6m, maduración, vector de TC, etc.).
- `created_at = NOW()` es clave: el guard reusa buró **< 1 mes** → salta la consulta real.

**Para que el usuario PASE las reglas del lender** (que aparezca/apruebe): el perfil (ingreso, score,
ocupación, edad) tiene que cumplir las reglas configuradas. Se derivan leyendo:
- `group_rules` + `lender_rules` (capa comercio, por `allied_branch_id`): ocupación/edad/ingreso mínimos.
- `lender_users_category_rules.min_score` (rt=2, cupo) o `lender_datacredito_rules.score` (rt≠2).

Regla práctica: `ingreso ≥ mayor umbral`, `score ≥ mayor min_score + margen`, ocupación/edad dentro del rango.

---

## 4. La encriptación del buró (Laravel) — lo no-obvio

El `data` de `risk_central_user_data` usa el cast `encrypted:collection` de Laravel. Hay que producir
exactamente ese envoltorio o legacy no puede desencriptar `$user->datacredito->data`.

**Formato** (`\Illuminate\Encryption\Encrypter`, AES-256-CBC):
```
payload = base64( json{ iv, value, mac, tag } )
  value = base64( AES-256-CBC( PKCS7(plaintext) ) )
  iv    = base64( 16 bytes aleatorios )
  mac   = hex( HMAC_SHA256( key, iv_b64 . value_b64 ) )   ← concatena los STRINGS base64
  tag   = ""   (CBC no es AEAD)
key = base64_decode(APP_KEY sin el prefijo "base64:")  → 32 bytes (AES-256)
```

**Python:**
```python
import os, json, base64, hmac, hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

def laravel_encrypt(plaintext: str, app_key: str) -> str:
    key = base64.b64decode(app_key.split("base64:", 1)[-1].strip())   # 32 bytes
    iv = os.urandom(16)
    padder = PKCS7(128).padder()
    padded = padder.update(plaintext.encode()) + padder.finalize()
    enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ct = enc.update(padded) + enc.finalize()
    iv_b64, val_b64 = base64.b64encode(iv).decode(), base64.b64encode(ct).decode()
    mac = hmac.new(key, (iv_b64 + val_b64).encode(), hashlib.sha256).hexdigest()
    env = {"iv": iv_b64, "value": val_b64, "mac": mac, "tag": ""}
    return base64.b64encode(json.dumps(env).encode()).decode()
```

**El plaintext** (perfil del buró que legacy lee de `data`) — ejemplo "limpio" que aprueba:
```json
{
  "agregatedInfo": {
    "overview": {
      "principals": { "currentNegativeCredits": 0, "negativeHistoricalLast12Months": 0,
                       "consultedLast6Months": 1, "maturationSince": "2015-01-01" },
      "balances":   { "valueMonthlyPayment": 100, "totalValueBalanceOverdue": 0 }
    }
  },
  "creditCard":  [ { "status": { "account": { "businessAccountStatus": "00" },
                                 "payment": { "businessBureauEvent": 1 } },
                     "creditCardAccount": { "businessBehaviourVectorProduct": "111111111111111111111111" } } ],
  "liabilities": [ { "liabilitiesAccount": { "businessBehaviourVectorProduct": "NNNNNNNNNNNNNNNNNNNNNNNN" } } ]
}
```
> El mismo JSON (o una versión con score) se guarda también en `user_summaries.datacredito.data`.

---

## 5. Arquitectura sugerida — server + frontend

Igual que lo tenemos nosotros: separar **operaciones de DB** (server) de la **UI** (panel).

### Server (Python: FastAPI/Flask + PyMySQL)
Endpoints mínimos:
| Endpoint | Hace |
|---|---|
| `GET /merchants?q=` | busca comercios (allieds + su sucursal/hash) |
| `POST /assign` | re-apunta el asesor a `allied_id/branch_id` (§2.3) |
| `POST /scrub` | borra el cliente por teléfono (y sus user_requests + filas hijas) → register limpio |
| `POST /synth-fill` | inserta el cliente sintético + buró sobre un `user_request` (§3) |
| `GET /whois?sub=` | asignación actual del asesor |

- Conecta a dev con las creds (VPN) + `connect_timeout=30`.
- Usa `laravel_encrypt` (§4) con el `APP_KEY` de dev para el `data` del buró.
- **Guard de escritura:** exigí un flag explícito (ej. `X-Confirm-Dev: 1`) antes de escribir en dev.

### Frontend (HTML simple que llama al server)
- **Cards de comercios de prueba** (Motai, Pullman, …) → elegís uno → botón "asignar".
- **Form del usuario sintético**: identidad + ingreso/score/ocupación + (opcional) tipo de doc.
- **Switch buró**: *Sintético* (inserta buró, salta consulta real) vs *Real* (consulta con datos reales).
- Botón **Lanzar**: prepara (assign + scrub + synth-fill) y abrís el wizard en `/merchant/<hash>/solicitar`.

### Tablas hijas a limpiar en el "scrub" (antes de borrar el user)
`user_summaries, user_field_values, risk_central_user_data, user_requests, confirmation_email_logs,
lender_transactions, user_request_products, creditop_x_user_requests_records, …`
(borrar por `user_request_id` y por `user_id`, con FK checks off en una transacción).

---

## 6. Notas de operación

- **OTP:** en **dev** el envío es real (te llega el SMS al número que pongas); podés usar un teléfono de
  QA con bypass si existe. En **local NO hay envío** (el MS de mensajería no corre) → por eso conviene el
  **cliente sintético + buró inyectado** (usa un teléfono bypass que saltea OTP).
- **Buró real vs sintético:** si insertás el buró (reciente) **antes** de personal-info, el backend lo
  reusa y NO consulta la central. Si querés una prueba REAL, no insertes nada → deja que consulte.
- **response_type del lender** (tabla `lenders`): rt=2 = CreditopX in-platform (decide en legacy, cupo por
  `lender_users_category_rules`); rt=1 = integración externa (decide la API del lender); rt=0 = estándar.
  Para probar 100% en la DB conviene rt=2.

## 7. Referencia rápida de tablas
| Tabla | Qué es |
|---|---|
| `allieds` / `allied_branches` | comercio / sucursal (el `hash` va en la URL) |
| `lenders` | entidades (columna `response_type`) |
| `lenders_by_allied_branches` | qué lenders ofrece cada sucursal (status, url, sort) |
| `lenders_by_allieds` | config del lender por comercio (cupo/calculadora/sort) |
| `users` | asesor (con `cognito_id`) o cliente (sin `cognito_id`) |
| `user_requests` | la solicitud (application): user + branch + amount + lender + status |
| `user_summaries` | resumen del cliente (agildata empleo/ingreso + datacredito) |
| `user_field_values` | campos del formulario (87 ingreso, 29 ocupación, …) |
| `risk_centrals` / `risk_central_user_data` | centrales / el buró del usuario (score + data encriptado) |
| `group_rules` / `lender_rules` | reglas de perfil por sucursal (capa comercio) |
| `lender_users_category_rules` | reglas de cupo/categoría rt=2 |
| `lender_datacredito_rules` | reglas de datacrédito rt≠2 |
