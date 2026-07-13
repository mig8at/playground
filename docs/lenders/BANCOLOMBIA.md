# Bancolombia — BNPL (68) y Consumo (100)

> Ficha de entidad (vista transversal). Dueño del detalle: [AGREGADORES-FLUJO-ANALISIS.md](../codigo/AGREGADORES-FLUJO-ANALISIS.md) §3 (+ §4 Corbeta).

**Un banco, DOS productos como lenders separados:** **68 = "Compra y paga después" (BNPL)** y **100 = "Crédito de consumo"**.
El código los intercambia (`lender_id==100 → 68` en `BancolombiaBnplController.php:112` y 8+ lugares — swap `BC_PAGA_DESP ↔ BC_CONSUMO`).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **La API del banco**: BNPL `POST /prospect-validation/validate-quota` (`data.validate==true`) · Consumo `POST /customers/validate` (`=='Success'`) |
| ¿Quién pone la plata / cobra? | Bancolombia (CreditOp no lleva la cartera; solo espeja estado) |
| ¿Cómo cierra? | Secuencia **multi-step in-app** contra la API (BNPL: provide/login/retrieveQuota/…/origination · Consumo: validate/…/disbursement) → `LenderTransaction` espejo → Estado 11 **asíncrono** |
| ¿Simulable E2E? | ❌ decide la API del banco (frontera synth). Mock local: `AppServiceProvider::fakeBancolombiaForLocal` + cédulas sandbox guardadas por entorno |

## Lo distintivo

- **La integración más "pesada" en seguridad de canal:** OAuth2 por scope + **JWT RS256 firmado con la privkey del comercio** + `X-Client-Certificate` (mTLS). Credenciales por comercio.
- **Montos mínimos quemados:** BNPL **$100.000** (`PreApprovedLenderService.php:744`) · Consumo **$1.000.000** (`:795`, además fuerza `amount=1000000` al pre-aprobar).
- **Consumo "aprueba suave":** si `validate != 'Success'` igual se muestra como 'Probabilidad media' (no desaparece). El 409 `BP40920507` ("persona no habilitada") se trata como **no-cupo**, no como error.
- **Corte por horario** en BNPL (`available_until`).
- **Corbeta (Alkosto/K-TRONIX/Alkomprar) monta retail batch ENCIMA de Bancolombia:** genera orden/PIN (`convenio_bnpl` vs `convenio_consumo`), factura por **crons diarios** (`invoice-process-corbeta*`), actualiza órdenes cada 2h y concilia a las 07:00 — todo en `application`. Dueño: [AGREGADORES-FLUJO-ANALISIS.md](../codigo/AGREGADORES-FLUJO-ANALISIS.md) §4.
- **No pasa por el `register()` genérico** (BNPL tiene secuencia propia) — ejemplo de "cada banco su Action a medida" ([CREDITOP.md](../CREDITOP.md) §8).

## Hardcodes que lo tocan (muestra)

Swap 68↔100 en 8+ sitios · montos min quemados · cédulas de prueba bajo guard `!isProduction()` (`BancolombiaBnpl.php:720-728`) · inventario: [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) §2, §5, §6.
