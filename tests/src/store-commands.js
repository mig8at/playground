// Los comandos de consola que hay que correr para que una tienda de prueba pueda comprar con CreditOp en qa, en
// el orden en que se corren. La misma receta que `tests/README.md` §3; si cambia una, se cambia la otra.
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
        what: 'Comprobar que el conector responde',
        why: 'Si da 200, el conector ya está linkeado y se puede comprar. Si no, va el paso siguiente.',
        cmd: 'curl -s -o /dev/null -w "%{http_code}\\n" https://migueldev--creditop.myvtex.com/_v/creditop.creditop/v4/manifest',
      },
      {
        what: 'Linkear el conector',
        why: 'Sube el conector de tu máquina al workspace y queda corriendo. Los cambios que deja en node/ no se commitean.',
        cmd: 'cd ~/Desktop/CREDITOP/github/vtex && vtex link',
      },
      {
        what: 'Cargar las bicicletas de prueba',
        why: 'Deja en el catálogo los mismos 6 productos de Shopify, con nombre, precio, imagen y stock. Se puede repetir sin duplicar. El catálogo es de toda la cuenta, también master.',
        cmd: 'cd ~/Desktop/CREDITOP/playground && python3 tablero/tasks/integracion-vtex/artifacts/cargar-bicicletas.py',
      },
    ],
  },
]
