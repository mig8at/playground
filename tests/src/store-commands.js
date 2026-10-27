// Sólo los comandos que dejan una tienda de prueba lista para iniciar una compra con CreditOp en qa, en el orden en
// que se corren. La misma receta que `tests/README.md` §3; si cambia una, se cambia la otra.
export const STORE_COMMANDS = [
  {
    store: 'Shopify',
    about: 'La tienda creditop-dev-store sólo ofrece pagar con CreditOp mientras la app corre en tu máquina: el checkout y el aviso del resultado pasan por un túnel que abre shopify app dev.',
    steps: [
      {
        what: 'Levantar la app de pagos',
        why: 'Abre el túnel y deja la app escuchando: sin esto el medio de pago no aparece y «Volver a la tienda» no abre. Queda corriendo; se corta con Ctrl+C.',
        cmd: 'cd ~/Desktop/CREDITOP/github/shopify && CREDITOP_LOCAL=1 CREDITOP_ENVIRONMENT=develop npx shopify app dev --config shopify.app.creditop-ecommerce-payments-local.toml --store creditop-dev-store.myshopify.com',
      },
      {
        what: 'Apuntar la extensión al túnel nuevo',
        why: 'El túnel cambia en cada arranque. Se corre en otra terminal con la URL https://…trycloudflare.com que imprimió el paso anterior.',
        cmd: 'cd ~/Desktop/CREDITOP/github/shopify && npm run extension:url -- https://<túnel>',
      },
    ],
  },
  {
    store: 'VTEX',
    about: 'La tienda de prueba es el workspace de desarrollo migueldev, nunca master. El conector de CreditOp tiene que estar linkeado en ese workspace.',
    steps: [
      {
        what: 'Iniciar sesión en la cuenta',
        why: 'Abre el navegador para entrar a la cuenta creditop. Hace falta una vez por sesión de VTEX.',
        cmd: 'vtex login creditop',
      },
      {
        what: 'Entrar al workspace de pruebas',
        why: 'Todo lo que siga (link, catálogo de la tienda) queda en migueldev y no toca la tienda real.',
        cmd: 'vtex use migueldev',
      },
      {
        what: 'Linkear el conector',
        why: 'Sube el conector de tu máquina al workspace: sin esto la tienda no ofrece pagar con CreditOp. Queda corriendo; los cambios que deja en node/ no se commitean.',
        cmd: 'cd ~/Desktop/CREDITOP/github/vtex && vtex link',
      },
    ],
  },
]
