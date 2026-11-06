# VTEX · lo que se hizo el 2026-11-06

El detalle de cada medición (comandos y lo que dieron) está en la pila de la tarea, en los bloques del día. Esto es el
recorrido completo y el índice de las fotos.

## Lo que se logró

1. **Compra a mano en la tienda, aprobada desde ecommerce-v2** (12:55). Pedido `1674340500366-01`, solicitud 504666:
   VTEX la dejó Approved con la 5.0.3. Como la 5.0.3 no manda las aceptaciones, el wizard pidió celular y código.
2. **Un cobro se cayó al facturar, y no se repitió** (13:07 y 13:19). El conector no contestó en 30 s y VTEX no lo
   reintentó en el momento. El cobro manual pasó en 0,8 s, y dos cobros nuevos, uno de ellos tras 7 minutos sin
   tráfico, también pasaron. Queda como falla puntual de VTEX IO, con los logs sin leer.
3. **Mario Hernández copiado de prod a qa** (13:46). Comercio 350 «PRUEBA AUTO · Mario Hernández», entidad 200
   (CreditopX rotativo), sucursal 2233 `1126106a` con credencial VTEX. Sólo configuración, sin clientes ni secretos.
   Le faltaban los rangos del multiplicador y las llaves de la tienda; ahora el copiador los trae.
4. **La tienda VTEX compra contra la copia de Mario** (14:03). Se creó la afiliación «Mario Hernández (qa)», y
   «Creditop qa» se apunta a ella sólo mientras dura la prueba. Pedido `1674350500374-01` Approved.
5. **Compra cerrada con el rotativo de Mario, sin simulador** (14:29). Pedido `1674350500388-01`, solicitud 504683,
   9 → 3 → 10 → 11, VTEX Approved. Fotos en `1-rotativo-mario-800k/`.
6. **Bug del rotativo encontrado y arreglado** (14:33 y 14:51). Una compra por más de la mitad del cupo termina en
   «No pudimos cargar la información del pago» (pagaré 403 `INITIAL_FEE_PAYMENT_REQUIRED`): la compra ya cuenta como
   cupo usado. El arreglo está en legacy-backend#1881, hacia qa, y en local llega a `loan-approved`. En prod nadie
   tocó ese camino en 90 días: Mario sería el primero. Fotos de la segunda compra ($1.100.005, solicitud 504693) en
   `2-rotativo-mario-1100k/`.
7. **El auto-onboarding por payment-link funciona en qa** (15:06). Con las aceptaciones y las fechas, el comprador va
   por `validando` al listado sin celular, código ni formulario; sin las aceptaciones, pide el código. Fotos en
   `3-auto-onboarding-qa/`. Comando: `make harness-auto-onboarding TARGET=qa`.
8. **Switch «Auto-onboarding con Creditop» en el conector** (15:46). Va en la versión 5.1.0, PR vtex#25. Apagado por
   defecto; encendido, lee del pedido las fechas y la aceptación y las manda a payment-link. Casos locales 20/20. El
   conector real en local contra qa saltó SMS y formulario (solicitud 504701).
9. **El checkout de la tienda pide los datos de Creditop** (16:00). Tema 0.2.0 en el workspace de desarrollo
   `autoonb`. Sin los datos no deja comprar; con ellos, el pedido `1674370500394-01` los guarda en `customData`.
   Fotos en `4-checkout-autoonb/`.

También del día, fuera de VTEX pero para esta prueba:
- `make harness-rotativo` y el caso `rotativo` de `make harness-vtex`;
- `make harness-auto-onboarding`;
- las fotos por pantalla del caminador;
- el navegador con pestañas en paralelo, que sigue a Claude.

## Lo que quedó pendiente

- **El conector 5.1.0 en VTEX IO.** `vtex link` falla con 403 del compilador («Failed to fetch payment methods from
  PaymentGateway API»), también con el código de `main`. Volver a entrar no lo destrabó. Sin eso no está probada la
  lectura del pedido con `OMSViewer`.
- **Publicar la 5.1.0 en `master`**, sólo después de aprobar vtex#25. Recién instalada aparece el switch en la
  configuración de la app.
- **Después del merge de legacy-backend#1881 a qa**, correr `make harness-vtex TARGET=qa CASES=rotativo`: tiene que dar
  verde.
- **La tienda real de Mario** necesita el script del checkout, la app `creditop` en la configuración del checkout y su
  sucursal en `auto_onboarding_allied_branches`. Hay que confirmar los enlaces de términos y política de producción:
  hoy apuntan a los PDF del bucket de dev.
- **Decisiones de Producto y Operaciones:**
  - cancelar una solicitud en curso cuando la tienda cancela;
  - reembolsos;
  - vencimiento del enlace;
  - la sucursal y el token de Mario en prod;
  - quién recibe el correo de cobro caído.
- **Los workspaces `develop` y `migueldev` ya no existen.** Quedan `master` y `autoonb`. El tema 0.2.0 sigue enlazado
  en `autoonb`.

## Fotos

| carpeta | qué muestra |
|---|---|
| `1-rotativo-mario-800k/` | compra de $800.005 con el rotativo de Mario, pantalla por pantalla hasta el pedido Approved en VTEX (`11-vtex-pedido-aprobado.png`) |
| `2-rotativo-mario-1100k/` | compra de $1.100.005, por encima de la mitad del cupo |
| `3-auto-onboarding-qa/` | `con-*`: entra por «validando» y llega al listado · `sin-*`: sin aceptaciones pide el código |
| `4-checkout-autoonb/` | el bloque de Creditop en el checkout: vacío, frenando sin datos, completo, con el texto corregido y, sin el switch prendido, sin pedir nada |
| `switch-check.mjs` | prueba del script con la ruta del switch en true, false y 404 (correr desde `harness/`, que tiene Playwright) |
