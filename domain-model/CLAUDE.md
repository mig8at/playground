# CREDITOP · domain-model (deber-ser v4)

App Vue 3 + Vue Flow que visualiza el **modelo de dominio "deber-ser"** de Creditop.
Fuente de verdad de la viz: `src/data/modelo-dominio.json` (8 contextos · 105 entidades · 75 value-objects · 21 aggregate roots). Ver `README.md` para el detalle del modelo y los scripts `apply-*`.

## 🔌 Base de datos LOCAL disponible (copia de dev) — ÚSALA para análisis real

Existe una **copia local completa de la BD de producción/dev** corriendo en Docker. Cualquier
análisis "modelo vs. realidad" debe consultar estas tablas reales en vez de adivinar.

- **Contenedor:** `legacy-backend-mysql-1` (MySQL 8.0.35, puerto 3306)
- **Base:** `creditop` · **root:** `root` / `password` · **usuario app:** `creditop` / `password`
- **Contenido:** 212 tablas + 42 rutinas + 25 vistas (mismo esquema que dev). Datos reales en
  ~160 tablas; **28 tablas de telemetría/log vienen vacías** (su esquema sí está) — ver
  `~/.claude/.../memory/local-db-mirror.md`.

**Cómo consultarla** (no hay `mysql` en el host; se usa el cliente del contenedor):

```bash
docker exec legacy-backend-mysql-1 mysql -uroot -ppassword creditop -e "SHOW TABLES;"
docker exec legacy-backend-mysql-1 mysql -uroot -ppassword creditop -e "SELECT COUNT(*) FROM user_requests;"
# describir una tabla
docker exec legacy-backend-mysql-1 mysql -uroot -ppassword creditop -e "DESCRIBE lenders;"
```

Helper: `bash scripts/db.sh "SELECT ..."` (ver `scripts/db.sh`).

**Modo mock del legacy-backend** (para pruebas rápidas que necesiten la API, no solo la BD): el
legacy tiene un perfil que levanta los **recursos externos en fake** (KYC, S3, Wompi, lenders del
marketplace, OTP) sin VPN ni proveedores reales — `cd ../../github/legacy-backend && make up && make
mock-all && make restart`. Detalle/matriz en `github/legacy-backend/docs/local-dev.md`. El viejo
`mock-server` (`validation-driven/MOCK_SERVER`, :4000) **ya no se usa** (superado por este modo).

**Refrescar dev→local:** `cd ~/Desktop/CREDITOP/db-dump && bash dump-dev.sh && bash import-local.sh`
(dump read-only desde RDS dev; import sobrescribe el `creditop` local).

## 📋 Artefactos de auditoría modelo↔realidad (`docs/audit/`)

- `real_tables.txt` — las 212 tablas reales (1 por línea).
- `real_columns.tsv` — `tabla \t columna \t tipo` de todas las tablas (2582 filas).
- `ground-truth.json` — cruce determinístico: estado de cada entidad
  (`mapeada_ok` / `NUEVA_greenfield` / `REF_ROTA` / `externo`), refs a tablas y columnas reducidas.
- `scripts/audit-legacy-refs.mjs` — regenera `ground-truth.json` (`node scripts/audit-legacy-refs.mjs`).

**Convención del modelo** (al leer `entidad.legacy`):
- `tabla` y `absorbe[]` → referencias a **tablas reales** (deben existir en `real_tables.txt`).
- `reducidas[].legacy` → **columnas** colapsadas/derivadas (NO son tablas).
- `ref` con texto `"green-field (...)"` → entidad **nueva** a propósito (sin tabla legacy).
- atributo con `nuevo:true` → **columna nueva del deber-ser** (no existe en la tabla legacy); se distingue de "olvidé mapear". Se aplica con `scripts/apply-alignment-fixes.mjs` y se ve como badge **nuevo** en el ERD.

Reporte de alineamiento modelo↔realidad: `docs/audit/ALINEAMIENTO.md`.

## 🏗️ Cómo funciona Creditop HOY (realidad de los repos)

> 📖 **Contexto completo en inglés: [`CONTEXT.md`](docs/CONTEXT.md)** — flujos end-to-end con rutas de
> archivo + falencias actuales, para no tener que leer los repos `legacy-backend`/`application`.
> Versión larga en español: `docs/audit/REALIDAD-ACTUAL.md`.

Resumen para contextualizar:

- **3 repos** (todos bajo `~/Desktop/CREDITOP/`):
  - `bitbucket/application` — **monolito Laravel 10**, dueño del esquema `creditop` (313 migraciones); subdominios `admin.`/`aliados.`/`perfil.`/`api.`
  - `github/legacy-backend` — Laravel **modular** (Modules/: Identity, Loans, Onboarding, Partner, Payments, Risk, System); API de originación (*el nombre engaña: es el más nuevo*).
  - `playground/backend-e2e` — harness Go que **valida la realidad** contra API+BD (flujos + `prep`/`get`/`doctor`). El conocimiento validado vive en `playground/docs/` (hallazgos-backend, flujos-especiales, schema-remoto-logic) y `domain-model/docs/` (HALLAZGOS-BD + evolución del deber-ser). *(Consolidó al extinto `creditop-cli`.)*
- **Frontera:** `application` y `legacy-backend` **comparten la BD `creditop` Y se llaman por HTTP interno** (`INTERNAL_LEGACY_API_URL`); la originación está a medio migrar (bypass por `allied.hash`). ⚠️ **Dos bases en dev con IDs distintos**; nuestra copia local viene del dump de `inertia-dev` (RDS de `application`) → usa **esos** IDs.
- **Flujo:** Comercial(#4) vende → personal/laboral-info → KYC → riesgo (motor SQL) → marketplace (reglas comercio AND lender) → cierre bifurcado por `response_type` (5 patrones) → estados convergen en 11.
- **Motor de scoring vive en SQL** (26 vistas + 42 rutinas: `SP_Update_*_Risk_Centrals`, `SP_Experian_Extract_Data`, `FN_User_Income_Average` waterfall AgilData→Mareigua, `SP_CreditopX_Revolving_Credit`, `FN_Decrypt_Data` con clave AES quemada) — casi NO está en el modelo.
- **Cierre por lender = híbrido data+hardcode** (`lenders.action` FQCN solo en 16/153; `switch(lender_id/name)` + STATUS_MAP por clase Action).
- **Reglas duplicadas:** ~38k `lender_rules` / 142 lenders / solo 63 triples distintos (age>=18 en 80, ocupación en 141) → `RuleDefinition` justificada.
- **Roles:** `roles`(13) y `user_profiles`(12) gemelas; 5 roles back-office = mismos permisos, difieren por el **estado que autorizan**; gating real por permiso-string Spatie en el front (no `autorizar:{etapa}`).
- **Flujos especiales NO modelados:** PEP, Motai(#158), Corbeta(209/210/211), Pullman(#94), Dentix(#189), Smartpay, Magnocréditos(#84).
