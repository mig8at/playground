# Canon por tipo, no por comercio — diseño (2026-09-25)

Propuesta acordada con Miguel el 2026-09-25. Es un plan: nada de esto está en canon todavía.

## El problema

Canon tiene un tema por entidad o comercio (`motai`, `welli`, `meddipay`, `nequi`, `bcp`,
`credifamilia`…) y ninguno por el **tipo** de flujo que comparten. Medido sobre el corpus del
2026-09-25 (35 temas, 1.011 archivos declarados): los archivos que más temas declaran son el listado
del front, `services.php` y el servicio de onboarding (7 temas cada uno), y los temas que los comparten
son siempre los de entidad. Es una sola regla —cómo entra una entidad al listado y cómo cierra—
contada seis veces, que envejece seis veces. Y un comercio nuevo del mismo tipo (Alta, renting / rent
to own) no tiene dónde caer: o se le abre otro tema, o no se escribe.

## El reparto real (entidades activas en producción, 2026-09-25)

| tipo | entidades | con uso 90 d | ejemplos |
|---|---|---|---|
| rt0 redirige | 55 | 22 | Addi, Sufi, Sistecrédito |
| rt1 integración | 16 | 11 | Bancolombia, Welli, Meddipay, Prami, Crédito365 |
| rt2 CreditopX por categorías | 101 | 30 | Creditop X, Mediarte X |
| rt2 + garantía IMEI (path 2) | 5 | 5 | SmartPay, Crédito Directo X |
| rt2 producto `renting` / `rto` | 2 | 2 | Motai Renting, Rent to Own |
| rt3 rotativo | 18 | 3 | Credifis X |
| rt4 híbrido | 1 | 1 | Credifamilia |

## La taxonomía: tres ejes, los ids del harness

Los ids salen de `harness/panel/steps.json` (ramales `creditopx` · `agregador` · `redirect`, desvíos
`abaco` · `imei`, extensión `credifamilia`): dos vocabularios para lo mismo es como empiezan a derivar.

1. **Quién decide y cómo cierra** (tipo de respuesta):
   - `redireccion` (rt0)
   - `agregador` (rt1) → hijos con contrato propio: `bancolombia`, `welli`, `meddipay`, `credito365`, `bcp`
   - `creditopx` (rt2/3, el producto de la casa) → hijos `categorias`, `rotativo`, `renting` (renting y
     rent to own: Motai, Alta), `imei` (SmartPay y las otras cuatro)
   - `hibrido` (rt4) → `credifamilia`
2. **Por dónde entra el cliente:** `asesor`, `autogestion`, `ecommerce` (ya existe), `qr`, `mobile`.
3. **Las etapas, transversales:** `onboarding`, `kyc`, `preaprobado`, `listado`, `cuota`,
   `formalizacion`, `documentos`, `cartera` (ya existen).

Y aparte, **cobros** (`nequi`, Wompi, la cuota inicial): Nequi no presta, cobra.

## Cuándo algo merece tema propio

- **Un comercio: nunca.** Su particularidad va como sección con nombre dentro del tema de su tipo
  («Lo que es a la medida de Motai»): los ids quemados, las excepciones, los caprichos. Ahí se ve lo que
  cuesta el desarrollo a la medida, que es lo que se quiere dejar de hacer, sin darle un nodo.
- **Una entidad: sólo si tiene contrato de integración propio** (endpoints, webhooks, estados propios).
  Una rt0 que sólo cambia configuración vive en `redireccion`.
- **Un tipo: siempre**, con su `flow.json` (el recorrido, estaciones enlazadas a secciones).

## Lo que pide cambiar en canon (repo compartido, `tools/canon`)

1. **`parent` en el `map.json`.** Lint: el padre existe, el padre lista al hijo, no hay ciclos. Los
   nietos (`creditopx` → `renting` → `rto`) salen solos. La búsqueda sube la regla del padre; la UI
   muestra el árbol.
2. **El grafo por archivos compartidos se conserva y gana lectura:** un archivo declarado por hijos de
   padres DISTINTOS es un punto de acoplamiento (hoy, el servicio del listado lo declaran agregador,
   CreditopX e IMEI). Es un mapa de deuda que sale gratis.
3. **El cierre de un borrador con un tema recién abierto** no acuña los ids de sus secciones
   («el documento "context.md" no declara `sections`»), aunque el código de `main` ya crea el objeto
   vacío. Reproducir en local antes de tocar: el build de producción (`4f58d6d17836`) no es un commit
   del repo, así que no se puede saber desde acá si incluye `3a05860`. El rodeo que funcionó: crear el
   tema con `POST /api/topics`, su primera sección con `POST /api/topics/{tema}/sections`, y recién
   después el borrador.
4. **El catálogo de tablas está viejo:** `cards` y `lender_webhook_events` existen en producción y
   `/api/tables` da 404.

## La mudanza

- Crear los temas de tipo que faltan: `redireccion`, `agregador`, `categorias`, `rotativo`, `renting`,
  `imei`, `hibrido`, `cobros`, y los de canal `asesor`, `autogestion`, `qr`.
- Mover secciones conservando el ancla vieja como alias: `motai` → `renting` (y sumar Alta),
  `smartpay` → `imei`, lo común de `welli`/`meddipay`/`bancolombia`/`bcp`/`credito365` → `agregador`.
- Lo que quede en un tema de entidad es sólo su contrato propio.

## El criterio de admisión (para `skills/dictar.md`)

Entra información técnica, de negocio o de producto que existe hoy en `main`, que no se entiende
leyendo el código a simple vista y que le sirve a futuro a desarrollo, negocio o producto. Valen mucho
los hardcodes, los bypasses, las reglas que viven en configuración, las implementaciones que divergen,
las debilidades y lo que falla en silencio. No entra: la crónica (quién, cuándo, «antes era así»), lo
redundante (lo que otra sección ya dice: se enlaza), ni lo trivial (lo que el nombre de una función ya
dice). Un dato vivo con su alcance y su fecha sí entra.
