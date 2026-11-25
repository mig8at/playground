# Lo que las corridas le pueden enseñar a `flow`

> Propuesta escrita el **2026-08-23**, después de recorrer **las cinco familias de `response_type` de
> punta a punta en local** (rt=0/1 por webhook real, rt=2 y rt=4 hasta estado 11, rt=3 hasta donde
> revienta) y de medir producción con 90 días de datos.
>
> **Qué es y qué no.** Es una lista de brechas entre lo que `flow` modela y lo que las corridas
> mostraron, **cada una con su evidencia**. No es una auditoría del simulador —lo que ya modela está
> bien y el balance existente cubre mucho—; es lo que sólo se ve corriendo el sistema.
>
> ⚠ Está ordenada por **cuánto cambia el mapa mental**, no por costo.

---

## 1. El grafo termina en la firma. El flujo real **no termina ahí, y a veces ni siquiera termina acá**

Hoy el arco de salida llega hasta firma → enganche → Estado 11. Lo que las corridas mostraron es que
después de la firma pasan **dos cosas más**, y una de ellas **ocurre en otro sistema y en otro momento**:

- **La radicación.** Para Credifamilia, mandarle el paquete de documentos al lender es un paso
  **posterior** al Estado 11 que **no mueve el estado**. Si falla, la solicitud queda igual en 11, el
  endpoint devuelve 200 y todo parece bien: **el crédito quedó autorizado y el lender nunca lo recibió**.
  Sólo lo sabe la tabla `lender_transactions` (**F-168**).
- **El desenlace que llega de afuera.** Para rt=0 y rt=1 el crédito **no se decide en el flujo**: la
  solicitud queda en estado 3 y el resultado llega **después, por webhook**, a `legacy-application`.
  Verificado disparando los webhooks reales: `fulfilled`→11, `dismissed`→8, `rejected`→6,
  `pendiente_desembolso`→**28** (**F-170**, **F-171**).

**Qué agregaría:** un nodo de **RETORNO** después de la firma, con dos entradas —radicación y
webhook— que puedan fallar **sin mover el estado de la solicitud**. Es el único lugar del mapa donde
el tiempo corre para atrás, y hoy no existe.

---

## 2. «Aprobado» no es un estado: son **cinco desenlaces distintos**, y dependen de la familia

Medido corriendo las cinco familias en una sola tanda paralela:

| familia | dónde termina | qué significa |
|---|---|---|
| rt=2 · CreditopX | **11** Autorizada | decidió CreditOp |
| rt=4 · Credifamilia | **11** + `CREDIT_COMPLETED` | autorizada **y** radicada |
| rt=0 / rt=1 | **3** Seleccionó entidad | esperando el webhook de afuera |
| **Bancolombia (canal QR)** | **25** Pendiente de facturación | + código de compra; el desembolso es posterior y por afuera |
| rt=3 · rotativo | **10** Pendiente de autorización | revienta antes de autorizar (**F-169**) |

**Qué agregaría:** que el nodo de estado **muestre el estado terminal propio de cada familia** en vez
de un «aprobado/rechazado» único. Y en particular **el 25 de Bancolombia**: medirlo con la vara del
11 da cero por construcción, y esa es la lectura equivocada más fácil de hacer.

---

## 3. ⚠ La regla que más peso tiene en el simulador es la que más dudas tiene

`store.js:836` decide:

```js
verdict: ok ? 'pass' : (rt === 2 ? 'exclude' : 'classify')
```

O sea: si fallan las `group_rules`, a un **rt=2 lo excluye**. Pero **F-162** midió lo contrario en
producción —una entidad otorgó **1.923 créditos a `Empleado`** en sucursales cuya regla exige sólo
`Independiente`— y concluyó que **esas reglas clasifican, no excluyen**.

**No lo doy por resuelto**, y por honestidad: mi propia medición agregada (la ficha de entidades,
`context/docs/ENTIDADES.md`) encontró **sólo 2 divergencias**, no miles. La diferencia puede estar en
que F-162 miró reglas **por sucursal** y la ficha mira reglas **por entidad**. La consulta que lo
zanjaría expiró contra Redash.

**Qué haría:** medir eso **antes** de tocar nada. Es la línea de código con más consecuencias del
simulador —decide qué se cae y qué no— y hoy hay dos mediciones que no coinciden.

---

## 4. rt=0 no es «nadie decide», y es la familia **más grande**

En 90 días: **15.339 solicitudes (46 % del total)** y **4.196 autorizadas**. «Redirige a la web del
lender» describe la ida, no la vuelta: vuelven por un webhook **genérico** —uno solo para todas—.

**Pero la familia está partida en dos, y eso es lo interesante:**

| | entidades | solicitudes | autorizadas |
|---|---:|---:|---:|
| con integración (`action`) | **3** (Addi, +2) | 13.471 (88 %) | 3.638 |
| redirección pura | **17** | 1.871 | 559 |

Las 17 sin integración **igual acumulan 559 autorizadas**, o sea que cierran por un camino que **no
está identificado** (probablemente a mano, desde el panel).

**Qué agregaría:** partir el nodo rt=0 en esas dos ramas. Y dejar la pregunta abierta anotada: es un
hueco real del mapa, no una omisión del simulador.

---

## 5. El cliente que vuelve: lo que se gasta es el **cupo**, no la elegibilidad

Suposición natural —y equivocada— que yo mismo escribí en una suite y falló: *tener un crédito activo
excluye a esa entidad del listado*. **No.** La exclusión por crédito previo es una **lista quemada de
cinco ids** (`[12, 23, 141, 142, 166]`, `LenderRetrievalService:264`); para todas las demás lo que
cambia es `already_used_loan` contra `loan_limit` — y con un límite de 100 M, un crédito de 2 M **no
mueve nada**: la entidad sigue apareciendo.

**Qué agregaría:** que la segunda vuelta muestre el **cupo consumido**, no una exclusión. Es la
diferencia entre «no te la ofrecen» y «te la ofrecen por menos».

---

## 6. Los plazos no son libres — y el backend acepta cualquiera igual

Cada entidad ofrece su juego, medido corriendo: **Credifamilia 6/12/18/24 · CrediPullman 1/3/6 ·
Motai 6/12/24/36 · Sufi 3/6**. Pedir uno fuera de esa lista corta con un código genérico que **no
nombra las cuotas**.

⚠ **Y el que se confirma no se valida**: el campo que el controlador usa no tiene ninguna regla, y el
que sí se valida sólo exige `min:1`. Reproducido cerrando en 11 con **36 cuotas** en una entidad que
simula 6, 12, 18 y 24 (**F-167**).

**Qué agregaría:** el juego de plazos como dato **de la entidad** en el simulador, y el hueco de
validación como una nota — porque el número de cuotas define la cuota, el plan de pagos y el pagaré.

---

## 7. Tres puntos donde el flujo **revienta**, y los tres son invisibles hasta el final

El simulador muestra por qué una entidad **no aparece**. No muestra dónde el flujo **se rompe con la
entidad ya elegida**, que es peor: el cliente ya completó todo.

| dónde | qué lo dispara | evidencia |
|---|---|---|
| al **autorizar** un rt=2 | la entidad no tiene **ninguna categoría** configurada → 500 | **F-172** — y hay **6 entidades así, activas, en producción** |
| al generar documentos de un rt=3 | el cliente **no tiene cupo rotativo previo** → 500 | **F-169** — confirmado en 3 entidades distintas |
| con **dos** solicitudes rt=4 a la vez | deadlock; el error dice «no hay transacción activa» | **F-166** |

**Qué agregaría:** marcarlos en el grafo como **puntos de ruptura**, no como reglas. Los tres son de
configuración o de concurrencia, no de la decisión de crédito — y por eso hoy no tienen lugar en el
mapa.

---

## Lo que NO cambiaría

- **El enfoque.** Un grafo tocable es la forma correcta de explicar una cascada de cinco capas.
- **El arco de entrada y la decisión.** Lo que ya modela —catálogo, sucursal, datacrédito,
  perfilamiento, tramo— coincide con lo que las corridas mostraron.
- **El alcance.** Servicing sigue estando bien afuera.
