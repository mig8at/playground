# EXAMPLES.md — demos visuales

Comandos para probar el flujo de originación de forma visual en el wizard real (`:5174`). Todo desde
frontend-e2e. `<comercio>` = `pullman` · `celurd` · `motai` · `alkosto` (o cualquiera que resuelva en dev).

```bash
cd ~/Desktop/CREDITOP/playground/frontend-e2e
```

## Demos (split-view)

`--mode` ya implica el split-view (dos navegadores); `--store` arranca desde la tienda mock (implica `--ecommerce`).

| Comando | Flujo |
|---|---|
| `bin/asesor <comercio> --store --mode=creditopx` | rt=2 in-platform · A espera ⟷ B firma → loan-approved |
| `bin/asesor <comercio> --store --mode=external` | rt=1 · redirect al banco mock → vuelve a `/lender-result` |
| `bin/asesor <comercio> --store --mode=aggregator` | rt=0 · handoff por link de WhatsApp |

Ritmo y reinicio (antepuesto / con flag):
```bash
E2E_STEP_MS=2000 E2E_LINGER_MS=4000 bin/asesor pullman --store --mode=creditopx --fresh
```
`E2E_STEP_MS` = pausa entre pantallas de B · `E2E_LINGER_MS` = hold en pantallas clave · `--fresh` = reinicia el wizard.

**Lender ↔ comercio:** `--mode=creditopx` busca `credipullman` por defecto. Para `celurd` (SmartPay) indicá el lender:
```bash
bin/asesor celurd --store --mode=creditopx --lender=smartpay
```

## Inicio manual

```bash
bin/asesor <comercio>
```
Solo login + deja el wizard arriba (sin demo). Imprime la URL `/merchant/<hash>/solicitar` para entrar a mano.

Para un navegador **ya logueado** con la sesión guardada:
```bash
npx playwright open --load-storage=.auth/asesor-dev-state.json "http://localhost:5174/merchant/<hash>/solicitar"
```

## Avanzado

- Más flags de `bin/asesor`: `--lender=<id|nombre>` · `--no-assign` · `--down` · `--wizard=<url>` · `--headless`.
- Datos (dev): `node bin/dbops.ts list <comercio>` · `ecommerce-url` · `whois`.
- Pruebas de webhook/notificación a fondo: `backend-e2e` (`make help`).
