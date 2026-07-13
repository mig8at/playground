# Sistecrédito (9) — el de los dos canales físicos

> Ficha de entidad (vista transversal). Dueño: [AGREGADORES-FLUJO-ANALISIS.md](../codigo/AGREGADORES-FLUJO-ANALISIS.md) §3.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **API externa** — consulta el **cupo que el cliente ya tiene** con Sistecrédito (`getCreditLimitClient`: `statusName` / `availableCreditLimit` / `defaulter`) |
| ¿Quién pone la plata / cobra? | Sistecrédito |
| ¿Cómo cierra? | **Dos sub-modos por credencial** (dispatch en `Sistecredito.php:60-71`): **POS presencial** = OTP in-app (`getCreditToken` → OTP → `/create`, sin salir del wizard) · **Online/Pay** = `/pay/create` → redirect + **webhook entrante propio** |
| ¿Simulable E2E? | ✅ mock HTTP (`getCreditLimitClient`, `/pay/create`) |

## Lo distintivo

- **El único agregador con webhook entrante propio** (`SistecreditoController::webhook:80-128`) con mapa completo de estados: Approved→**11** (+voucher) · Pending/Started→10 · Expired/Failed/Rejected→6 · Cancelled→8. Los demás rt=1 cierran por polling o redirect-return.
- **Modelo "cupo pre-existente"**: no evalúa una solicitud nueva — verifica si el cliente **ya es cliente** de Sistecrédito con cupo disponible (y si es `defaulter`, lo baja).
- **Sensible por comercio:** Energiteca (allied 153) **elimina** a Sistecrédito del listado si no viene `Approved` (`PreApprovedLenderService.php:143`) — ejemplo de regla por comercio quemada en código.
- Rama de validación propia (defaulter / NoPOS) en `PreApprovedLenderService.php:79`.

## Hardcodes que lo tocan (muestra)

Filtro Energiteca (allied 153, colisión con lender 153=SmartPay) · rama propia en pre-aprobación · inventario: [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) §2-3.
