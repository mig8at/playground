# Pipeline de KYC v2 completo en local (2026-10-16)

Sin credenciales reales: kyc-gateway apunta SÓLO al mock local de centrales (:8105).
⚠ El `config/config.yaml` que vive en el repo de kyc-gateway apunta a las centrales REALES: no usarlo.

1. Temporal (imagen ya presente): `docker run -d --name cps-temporal -p 7233:7233 -p 8233:8233 --entrypoint temporal temporalio/admin-tools:latest server start-dev --ip 0.0.0.0 --ui-port 8233`
2. customer-profiling-service: `docker compose up -d` y `migrate -path internal/infra/storage/postgres/migrations -database "postgres://postgres:postgres@localhost:5435/customer_profiling?sslmode=disable" up`
   Compilar: `go generate ./internal/openapi` (tipos, en .gitignore) y `go build -o <dir>/customer-profiling ./cmd/http-server`.
3. kyc-gateway: `go build -o <dir>/kyc-gateway ./cmd/...`.
4. Cada binario se corre DESDE un directorio con su `config.yaml` (lo busca en `.`): `kyc-gateway.config.yaml` y `customer-profiling.config.yaml` de esta carpeta.
5. Base local de legacy: `kyc_pipeline_allieds` con el comercio (26), y los settings `experian_trigger_bypass_rules` y `kyc_document_not_found_bypass` (sin ellos `kyc-requirements` da 500, OBV27003).
6. `python3 recorrido.py [casos]`: dicta al mock, registro, OTP v2, datos personales v2, arranque y espera, y lee `users`.
