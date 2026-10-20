# Íconos de Creditop para Shopify

Salen del isotipo de la app móvil (`packages/cds_mobile/assets/logos/creditop_logo_square.svg` de `creditop_mobile`,
main 2dbedbe0): la «E» verde `#56d783` sobre el morado `#4b3bff`, los colores tal cual del sistema de diseño.

| archivo | para qué | dónde se carga |
|---|---|---|
| `creditop-app-icon-1200-square.png` | ícono de la app, 1200×1200, esquinas rectas (Shopify las redondea al mostrarlo) | Partner Dashboard → la app → App setup → App icon |
| `creditop-app-icon-1200.png` | el mismo con las esquinas redondeadas del ícono móvil, por si se prefiere | ídem |
| `creditop.svg` | ícono del medio de pago en el checkout (reemplaza «General Financing») | PR a `activemerchant/payment_icons` |

## El PR de `activemerchant/payment_icons`

⚠ El repo sólo revisa íconos aprobados por el equipo de Partners de Shopify: pedir la aprobación en el trámite de
Payments Partner antes de abrirlo.

1. `app/assets/images/payment_icons/creditop.svg` ← `creditop.svg` (una línea, 1,3 KB).
2. En `db/payment_icons.yml`, en el mismo grupo que `addi` y `generalfinancing`:

   ```yaml
   - name: creditop
     label: Creditop
     group: other
   ```

3. Cuando Shopify lo publique, en la extensión de pagos de la app: `supported_payment_methods = ["creditop"]` y
   `shopify app deploy`.

Validado contra las reglas de su `test/unit/payment_icon_test.rb` replicadas en Python (22 de 22): 38×24 con
`viewBox="0 0 38 24"`, `<title id="pi-creditop">Creditop</title>` como primer hijo, `role="img"`,
`aria-labelledby="pi-creditop"`, borde estándar (`path` con `opacity=".07"` negro), una sola línea, sin `style`,
`class`, imágenes ni fuentes, menos de 10 KB. Falta correr su suite en Ruby y pasarlo por SVGO.
