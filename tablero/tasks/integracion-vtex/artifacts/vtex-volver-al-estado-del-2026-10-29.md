# Cuenta VTEX `creditop`: cómo volver al estado del 2026-10-29

Tomado el **2026-10-29**, antes de instalar la 5.x en `master` y crear la afiliación del conector v5 para probar desde
cero. Si piden dejar la cuenta como estaba, estos pasos la devuelven. La foto completa de afiliaciones y condiciones
de pago (con los tokens tapados) está al lado: `vtex-estado-2026-10-29.json`.

La cuenta `creditop` es la de pruebas de Creditop en VTEX; los comercios tienen la suya. Nada de esto toca otra
cuenta, ni la app publicada (las cuentas con la 4.x siguen en la 4).

## Cómo estaba

**El conector instalado por workspace** (medido pidiendo `/_v/creditop.creditop/v<mayor>/manifest` en cada uno):

| workspace | contesta | qué es |
|---|---|---|
| `master` | v4 (la v5 da 404) | la tienda de la cuenta |
| `migueldev` | v4 | desarrollo de Miguel con `vtex link` (la rama ya dice 5.0.0: al volver a linkear contesta en v5) |
| `oscarrinc` | v4 | el workspace de Oscar |
| `piloto` | v5 (la v4 da 404) | creado el 2026-10-28, production=true, con `creditop.creditop@5.x` |

En `master`, `vtex ls` (2026-10-29, 08:59) decía **`creditop.creditop 4.0.1`** y `creditop.store-theme 5.2.0`.

**Afiliaciones** (todas del conector `creditop-creditop-v4`):

| nombre | id | modo | workspace |
|---|---|---|---|
| Creditop-test | `016cdf25-9bcb-4f67-ae13-e9c85fb80868` | producción | `master` |
| Creditop BNPL (de Oscar) | `58fe8b30-87e2-49a9-9152-798e40ca75d3` | test | `oscarrinc` |
| Creditop Miguel (dev) | `e362182a-5984-45cb-9821-461b83b60d24` | test | `migueldev` |

**Condiciones de pago** (medio de pago «Creditop», ninguna con condiciones especiales):

| nombre | id | afiliación | estado |
|---|---|---|---|
| Creditop - | `25b5ba28-621e-43d8-8d4e-e92f942680eb` | Creditop-test | apagada |
| CREDITOP DEV | `ae3136fe-f5b1-428d-82ef-d87696cd9234` | Creditop Miguel (dev) | **activa** |
| Creditop - | `76f567ad-a2f1-487e-b0be-6f7e98a85f4b` | Creditop BNPL (Oscar) | apagada |

Antes del 2026-10-20 la activa era la de Oscar; «CREDITOP DEV» la reemplazó para las pruebas de Miguel.

## Cómo volver

1. **Condiciones de pago** (admin → Pagos → Configuración → Condiciones de pago): apagar y borrar la de la afiliación
   v5; dejar activa sólo «CREDITOP DEV» y apagadas las otras dos, como en la tabla.
2. **Afiliaciones** (admin → Pagos → Configuración → Afiliaciones): borrar la del conector v5. Las tres de la v4 no se
   tocan.
3. **`master` a la 4**:
   ```sh
   vtex use master
   vtex install creditop.creditop@4.0.1
   vtex ls | grep creditop      # tiene que decir 4.0.1
   ```
4. **El piloto** (si también se quiere sacar):
   ```sh
   vtex workspace delete piloto
   ```
5. **La consola**, de vuelta al desarrollo: `vtex use migueldev`.

Cómo comprobar que quedó igual:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://creditop.myvtex.com/_v/creditop.creditop/v4/manifest   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://creditop.myvtex.com/_v/creditop.creditop/v5/manifest   # 404
```

y que la API de pagos (`/api/pvt/affiliations` y `/api/pvt/rules` de `creditop.vtexpayments.com.br`, con la llave de
`harness/.env.vtex`) devuelva lo mismo que `vtex-estado-2026-10-29.json`.
