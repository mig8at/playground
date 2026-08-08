---
id: 44
title: "SmartPay multipaís — sacar el país de las venas del código"
stage: backlog
created: "2026-08-08T09:00:00-05:00"
context_nodes: [smartpay, hardcodes-entidades, microservicios, entities, actors]
jira: []
jira_title: "Multipaís: el país deja de estar quemado en el código y pasa a ser configuración del mercado"
---

ESTADO 2026-08-08: análisis y medición hechos. **Nada tocado en los repos reales.** Falta decidir el
alcance con negocio (ver DECISIONES PENDIENTES) antes de escribir una línea.

## MEDICIÓN (2026-08-08, contra `main` de los 3 repos y prod)

**El tamaño.** Motai fueron 15 sitios en 3 repos. Esto es **~250 archivos**:

| | legacy-backend | application | frontend | 
|---|---:|---:|---:|
| `country_id` | 51 | 46 | 11 |
| prefijo `+57` | 42 | 10 | 23 |
| literal `Colombia` | 31 | 20 | 15 |
| `COP` | 16 | 8 | 36 |
| `DOP` | 5 | 4 | 5 |
| `es-CO` | — | — | 42 |
| `es-DO` | — | — | 6 |

La asimetría CO/DO en cada fila dice qué pasó: **RD se fue agregando caso por caso**, no como mercado.

**La buena noticia: el modelo ya tiene la dimensión.** `countries` tiene `currency`, `locale`,
`dial_code`, `cell_phone_lenght`, `iso_code_2/3`, `address_format`. Y hay `country_id` en `allieds`,
`lenders`, `users`, `settings`, `credit_lines`, `country_zones`, `corporate_users` y las taxonomías de
comercio. **No hay que inventar el mecanismo: hay que terminarlo y hacerlo obligatorio.**

**El mecanismo a medio construir.** El backend YA arma y envía `currency_format` por solicitud:

```php
$country = $userRequest->allied?->country;      // ← el mercado sale del COMERCIO
['locale' => $country?->locale, 'currency' => $country?->currency]
```

Está **copiado a mano en 4 controladores** (`ContinueUserFlowController.php:44`,
`PaymentScheduleController.php:93`, `ListLenderController.php:46`,
`ValidateOtpPromissoryNoteController.php:85`). Y el front lo consume en **2 lugares**
(`loan-approved.tsx:132`, `payment-schedule.tsx:241`) mientras hardcodea `es-CO` en ~40, incluido el
formateador compartido `packages/shared/utils/src/currency/formatter.ts:3` cuyo **default es `es-CO`** —
o sea que quien no pasa locale obtiene Colombia sin enterarse. Ya hay un comentario de alguien que se
chocó con esto: `additional-info-form.tsx:32` («Hardcoded hasta que se exponga»).

**El corazón del problema.** Esta línea aparece **cuatro veces, copiada**
(`TwilioController.php:187`, `NotificationService.php:114` · `:217` · `:251`):

```php
$isDoLogic = ($userRequest->lender?->country_id === 60)
          || $countryIso === 'DO'
          || str_contains($user->cell_phone, '+');
```

Tres problemas en una línea: **(a)** el mercado se re-deriva en cada sitio en vez de resolverse una vez;
**(b)** son tres fuentes distintas OR-eadas —lender, ISO y **el string del teléfono**—, y la tercera es
una adivinanza («si tiene un +, es dominicano»); **(c)** es binaria y en negativo: *«es RD, si no
Colombia»*. Un tercer país no entra sin reescribirla. Y `PaymentCalculationService.php:201` hace lo
mismo con `country_id != 60`.

⚠ **Y una MINA que hay que desactivar ANTES de tocar nada.** Hay **dos filas de Colombia** en `countries`:

| id | name | iso_2 | iso_3 | currency | locale | dial | apuntan |
|---|---|---|---|---|---|---|---|
| **1** | **Afghanistan** | (vacío) | **AFG** | **COP** | **es-CO** | (vacío) | **186 lenders · 364.527 users** |
| 47 | Colombia | (vacío) | COL | COP | es-CO | 57 | **307 allieds · 12.189 users** |
| 60 | Dominican Republic | DO | DOM | DOP | es-DO | 1 | 9 allieds · 1 lender |

Alguien le pegó los datos de Colombia a la fila de Afganistán. **Hoy no rompe nada** porque el camino
vivo resuelve por `allied` (que apunta a la 47, correcta) y porque `1 != 60` cae del lado colombiano por
casualidad. **Pero el día que alguien haga lo natural** —resolver el mercado desde el lender o desde el
usuario, que es justo lo que pide un documento por entidad o una validación de teléfono— **186 lenders y
364 mil usuarios se vuelven afganos**. Cualquier plan que empiece por «leamos `country_id`» rompe
producción en el primer deploy.

## LA PROPUESTA

### Idea 1 — «País» no es un eje, son cinco. Confundirlos es lo que produjo el desorden

Es el error que cometen todos los productos que crecen a un segundo país, y el que explica el
`$isDoLogic`. Un mercado son **cinco decisiones independientes**:

| eje | qué decide | de qué depende de verdad |
|---|---|---|
| **Jurisdicción** | qué regulación aplica (usura, habeas data, título valor, retención) | del **prestamista**, no del cliente |
| **Moneda** | en qué se denomina la deuda, con cuántos decimales | del **producto/línea de crédito** |
| **Locale** | idioma y formato de fecha/número que ve la persona | de la **persona**, no del país |
| **Geografía** | la división territorial y su codificación | del **domicilio** |
| **Identidad** | qué documento se pide y quién lo valida | del **país de expedición** |

No coinciden. Ecuador y Panamá usan USD (moneda ≠ país). Un dominicano en Colombia tiene locale es-DO y
jurisdicción CO. **La cédula de un colombiano la valida un buró colombiano aunque compre en RD.** Cada
vez que se los trata como una sola cosa se produce un `$isDoLogic`.

### Idea 2 — El mercado se resuelve UNA vez, en el borde, y se lleva puesto

Lo que hacen las plataformas que operan en varios países: un objeto **`MarketContext`** que se construye
al entrar la solicitud, a partir de una regla explícita y **una sola** —para CreditOp, el **comercio**
(`allied`), que ya es lo que usan los 4 controladores— y de ahí en adelante **nadie vuelve a preguntar de
qué país es esto**. Se pasa, no se re-deriva.

La prueba de que está bien hecho: **`country_id` deja de aparecer en la lógica de negocio.** Aparece una
vez, al resolver el contexto, y nunca más. Cada `if country == X` que sobreviva es un sitio que no se
convirtió.

### Idea 3 — Cada país es un PAQUETE, no una rama del `if`

Un mercado nuevo se da de alta **agregando un paquete y una fila de config**, nunca editando un `switch`.
El paquete implementa contratos estables:

- **buró/centrales** — CO: Experian/Datacrédito · RD: lo que use BHD
- **identidad** — qué documento, su formato, su validador
- **título valor** — CO: pagaré Deceval · RD: el instrumento que corresponda
- **geografía** — CO: DANE · RD: provincias/municipios
- **desembolso y recaudo** — CO: Wompi/PSE · RD: el recaudo referenciado BHD
- **parámetros regulatorios** — usura, salario mínimo, topes

⚠ **CreditOp ya tiene la mitad de esto y no lo sabe**: `lender->action` es polimórfico y
`PreApprovedLenderService` no lo usa (nodo `hardcodes-entidades`); `risk_centrals` ya es un catálogo de
proveedores con credenciales; `promissory_types` ya rutea el instrumento por lender. **Es el mismo patrón
recurrente de la casa: la solución está a medio construir y el código la esquiva.**

### Idea 4 — La plata es un objeto, no un número

El bug ya nos mordió: en el recaudo BHD los montos son **enteros con decimales implícitos**
(`13045` = RD$ 130,45), mientras en Colombia se manejan pesos enteros sin decimales. Un `float` que cruza
esa frontera pierde plata o la multiplica por cien. La regla es **importe + moneda juntos, siempre**, con
unidades mínimas explícitas, y sin `float` en ningún lado.

### Idea 5 — Los parámetros regulatorios son datos CON FECHA, no constantes

La usura colombiana cambia todos los meses y el salario mínimo todos los años. Un parámetro así no puede
ser una constante ni una fila que se sobreescribe: va con **vigencia desde/hasta**, porque para auditar
un crédito de marzo hay que saber cuál era el tope **en marzo**. Es la misma disciplina que ya usamos
para el contexto: describir lo que corría, no lo que corre.

### Idea 6 — El segundo país sólo se sostiene si el CI lo corre

Sin esto, todo lo anterior se degrada en tres sprints. La defensa real es **una suite que corre el mismo
flujo bajo dos mercados** y falla si el de RD se rompe. El `harness` ya sabe correr flujos completos:
es el lugar natural, y probablemente el entregable de más valor por hora de todo el plan.

## PLAN POR FASES

**F0 · Desactivar la mina (bloquea todo lo demás).** Decidir qué pasa con la fila 1: repararla o migrar
los 186 lenders y 364K usuarios a la 47. Y llenar `iso_code_2` (hoy vacío en las dos filas de Colombia,
mientras el código compara `$countryIso === 'DO'`). Sin esto no se puede empezar.

**F1 · Una sola fuente de verdad.** `MarketContext` resuelto en un lugar; los 4 `currency_format`
copiados pasan a leerlo; los 4 `$isDoLogic` se borran. Sin cambio de comportamiento — es refactor puro y
se puede verificar comparando respuestas antes/después.

**F2 · El front deja de tener default colombiano.** Quitar `es-CO` como valor por omisión del formateador
compartido: que sea **obligatorio**. Eso convierte ~40 hardcodes silenciosos en errores de compilación,
que es exactamente lo que se quiere.

**F3 · Extraer el primer paquete de país** por el eje que más duele en SmartPay, no por completitud.

**F4 · El CI con dos mercados** (podría adelantarse; es lo que protege F1-F3 de la erosión).

## DECISIONES PENDIENTES (no son técnicas — son de negocio)

- **¿Cuál es la unidad de mercado?** Hoy de hecho es el **comercio**. ¿Es correcto, o un comercio puede
  operar en dos países? La respuesta cambia el modelo entero.
- **¿A qué se apunta?** ¿Sostener CO+RD sin dolor, o poder abrir un tercer país sin release? El costo es
  muy distinto y F3/F4 sólo se justifican con lo segundo.
- **¿Quién define la jurisdicción de un crédito** cuando el comercio, el prestamista y el cliente no
  coinciden de país? Es una pregunta legal, no de arquitectura, y hay que hacérsela a alguien.
- **La fila Afganistán**: reparar o migrar. Migrar es más limpio y toca 364K filas.

## RIESGOS

- ⚠ **El deploy que «lee bien el país» es el que rompe producción**, si F0 no se hizo antes.
- **Un tercer país en el catálogo no es un país operativo**: hay 253 filas en `countries`, todas activas,
  y sólo 3 tienen locale en español. El catálogo es un volcado ISO con dos filas editadas a mano.
- **F1 no se ve.** Es refactor sin funcionalidad nueva: hay que venderlo como lo que es, la condición
  para que lo siguiente sea barato. Sin eso, se corta a la mitad y queda peor que antes.

## Tarea (publicable)

Hoy el país está quemado en el código en unos 250 archivos entre los tres repositorios, y la decisión de
"¿esto es Colombia o República Dominicana?" se re-calcula en cada sitio con criterios distintos — en un
caso, mirando si el teléfono del cliente tiene un signo "+". Eso hace que sumar o sostener un país sea
editar código en tres repos en vez de configurar datos.

La propuesta separa el país en los cinco ejes que realmente lo componen (jurisdicción, moneda, idioma,
geografía e identidad), resuelve el mercado **una sola vez** al entrar la solicitud y lo lleva a través
del flujo, y convierte cada país en un paquete de configuración en vez de una rama del código. Buena
parte del mecanismo ya existe en la base de datos y en el backend: el trabajo es terminarlo y hacerlo
obligatorio, no inventarlo.

Antes de escribir código hay que reparar el catálogo de países, donde hoy conviven dos registros de
Colombia y la mayoría de los datos apunta al que está mal.
