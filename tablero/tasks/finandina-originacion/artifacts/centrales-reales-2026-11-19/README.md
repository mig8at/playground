# Centrales reales con las cuentas de Finandina · 2026-11-19

Prueba hecha desde la máquina local de Miguel, con su cédula (1031138508, Miguel Ángel Ochoa Torres) y con su
autorización, contra los proveedores **reales**, no contra los mocks. Cada llamada replica la que hace legacy-backend.
Las cuentas salen del llavero personal de Miguel y no se imprimieron.

| central | cuenta | qué respondió | archivo |
|---|---|---|---|
| **Experian** (HDC+, ambiente de pruebas de Experian, `uat-api.datacredito.com.co`) | la de Finandina (REST con OAuth) | token **200**, consulta **200**. Código **14**: «La consulta fue efectiva, pero no hay información disponible para entregar por este canal de consulta». Identifica a la persona (OCHOA TORRES MIGUEL), con score 0 y sin obligaciones | `experian-hdcplus.json` |
| **Mareigua** (`macia.wikiplata.com:44375`) | la de Finandina (las claves del Drive) | `POST /token` **400** `invalid_grant`, «Login o contraseña incorrecta». No se llegó a consultar la cédula | `mareigua.json` |
| **Ágil Data** | — | **No se probó.** Finandina no tiene cuenta de Ágil Data: la cascada siempre consulta con la de CreditOp. Las credenciales reales de CreditOp sólo están en los secretos de los ambientes desplegados; en local hay un host falso y claves de relleno | — |

## Qué significa

- **Experian:** la cuenta de Finandina **funciona**: autentica y consulta. El código 14 es lo esperado en el ambiente de
  pruebas de Experian con una cédula real, que no entrega historia. Para ver un reporte completo hacen falta las cédulas
  de prueba de esa cuenta, que se piden a Finandina o a Experian.
- **Mareigua:** la cuenta de Finandina **no funciona**: mismo error que el 2026-11-18. Hay que pedirle a Finandina una
  cuenta de API de Mareigua válida. Se hizo **un solo intento** de token, para no bloquear la cuenta.
- **En local y en qa**, el flujo no prueba las cuentas: Ágil Data, Mareigua y Experian los contesta un mock, que no
  valida usuario ni clave. Lo que sí quedó probado ahí es que el sistema **elige** la cuenta de Finandina (Mareigua con la
  credencial 8 en local y la 14 en qa; Experian con la 11 en local y la 15 en qa).

## Cómo se repite

Los scripts replican los clientes de legacy-backend (`app/Actions/RiskCentrals/Mareigua.php` y el cliente de Experian HDC+):

```sh
bin/pg vault run --ring finandina-mareigua -- python3 -I mareigua.py <cédula> mareigua.json
bin/pg vault run --ring finandina-experian -- python3 -I hdcplus.py <cédula> <primer apellido> experian-hdcplus.json
```

⚠ `experian-hdcplus.json` trae el nombre y la cédula de Miguel: queda en la carpeta, pero sin commitear.
