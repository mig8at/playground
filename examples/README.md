# examples — prototipos HTML de un solo archivo

Piezas visuales autónomas (HTML+CSS+JS inline, sin build, sin servidor) que se usaron para **alinear con
negocio y con Jose antes de programar**, o para explicar un mecanismo del backend sin abrir el repo.

**Advertencia de arranque:** casi todo acá es **deber-ser o prototipo de discusión**, no el sistema real.
Algunas piezas ya se ejecutaron (la des-motaización de `merchant-config`/`calculadora-formulas`), otras
**nunca existieron** (el flujo ADO-first de `index.html`) y una **modela una regla al revés** que en producción
(Ábaco en `motai.html` — ver §"La trampa grande"). Si venís en frío buscando cómo funciona CreditOp hoy,
esta carpeta **no** es la fuente: leé `context/server/data/flows/*/doc.md`.

## Qué hay

| Archivo | Qué es | De cuándo | ¿Refleja el sistema real? |
|---|---|---|---|
| [`index.html`](./index.html) | Onboarding **ADO-first** rediseñado: cédula por cámara → consulta automática → marketplace → firma con rostro. Prototipo navegable de 3 pasos. | ~2026-07-02 (mtime; el git del playground se rehizo el 07-13) | **No.** Deber-ser del plan de simplificación. Nada de este recorrido está implementado. |
| [`motai.html`](./motai.html) | Simulador interactivo Motai v2 (Renting / Rent-to-Own): tocás monto, ingreso, score y reaccionan calculadora, reglas R1–R8 y veredicto del asesor. | 2026-07-14 | **Parcial.** La estructura (productos = lenders rt=2) se ejecutó en `feature/motai-v2`. **La regla de Ábaco está invertida.** |
| [`calculadora-formulas.html`](./calculadora-formulas.html) | Demo del procesador de fórmulas por lender: editás `lenders.calculator` y ves el paso a paso + por qué no es `eval`. | 2026-07-15 | **Sí**, es fiel — mismo JSON y mismo ejemplo que la migración real. |
| [`merchant-config/`](./merchant-config/) | 5 prototipos del modelo de renting por comercio (propuesta de negocio, niveles de config, consola del admin, recorrido del flujo). Tiene [su propio README](./merchant-config/README.md). | 2026-07-06/08, movidos acá el 07-18 | **Parcial.** Escrito *antes* de la des-motaización; parte ya se construyó. |

## Cómo abrirlos

```bash
open ~/Desktop/CREDITOP/playground/examples/motai.html   # doble clic sirve igual
```

Los tres archivos de la raíz son **100% autocontenidos** (cero `http://` externos, verificado con grep):
funcionan con `file://` y sin internet.

Si preferís servirlos:

```bash
cd ~/Desktop/CREDITOP/playground/examples && python3 -m http.server 8000
```

> **Gotcha — el target de `.claude/launch.json` está roto.** La configuración `merchant-config` (puerto 5191)
> sirve `Desktop/CREDITOP/playground/merchant-config`, carpeta que **ya no existe**: se movió a
> `examples/merchant-config` en el commit `e631279`. Arranca igual y devuelve 404 en todo. No lo arreglé.

## `index.html` — el flujo ADO-first (deber-ser)

Vende la tesis del plan de simplificación: **una foto de la cédula reemplaza los formularios**. Muestra el
"antes" (8+ pantallas: celular, OTP, datos personales, laboral, buró, documentos, espera, reintentos) contra
el "ahora" (escanear, elegir, firmar), y después se puede recorrer el prototipo entero — incluidos los 3
desenlaces por `response_type` (CreditopX firma ahí mismo · Bancolombia rt=1 redirige · Addi rt=0 referido).

**Por qué importa aclararlo:** el wizard real registra **134 rutas** en
`frontend-monorepo/apps/loan-request-wizard/app/routes.ts` (146 archivos de ruta bajo `app/routes/`,
repartidos en 14 subcarpetas: `abaco/`, `auth/`, `bancolombia/`, `dynamic/`, `imei/`,
`lenders-marketplace/`, `user-profiling/`…) — entre ellas `otp-validation`, `financial-profile`,
`identity-validation`, `sign-documents`, `additional-identity-validation-questionnaire`. Los números que
aparecen en la pieza (**−65% de código**, **0 formularios**, **aprobado en 38 segundos**) son **objetivos del
plan, no mediciones**. El −65% viene de la estimación de poda del god-service.

Contexto vivo del deber-ser: memoria `plan-simplificacion` + nodos `creditop` y `hardcodes-entidades` del
árbol de context. El doc original `docs/mejoras/PLAN-ACCION-SIMPLIFICACION.md` **ya no existe en `main`**
(recuperable con `git show 159906a:docs/mejoras/PLAN-ACCION-SIMPLIFICACION.md`).

## `motai.html` — el simulador Motai v2

Nueve tarjetas encadenadas, todas reactivas: config del comercio → solicitud → marketplace de lenders →
ingresos → calculadora → identidad (ADO/AML) → reglas R1–R8 → decisión/codeudor → pantalla del asesor.
Cada tarjeta lleva además una pregunta abierta marcada **PEP** (el caso migrante sin buró), que era el punto
de la reunión.

Detalles que sí están anclados en algo real:

- La calculadora usa las fórmulas de *"Calculadora Renting VF.xlsx"*: alistamiento `$1.500.000`, IVA 19%,
  tasa mensual 1,8%, tasa semanal derivada `(1+i)^(12/52)−1`.
- `R1–R8` aplican **solo** a Renting y RTO; Motai Credit cae en la política de crédito estándar
  (`aplicaPolitica()`, línea ~1395).
- El veredicto es: identidad → reglas duras → ingreso ≥ $3.000.000 aprueba directo → si no, codeudor con
  score > 650 → si no, rechazo.

### La trampa grande: acá Ábaco **decide**, en el sistema real **no**

En `motai.html` el ingreso de Ábaco entra al consolidado y ese consolidado maneja la decisión y dos reglas:

```js
// motai.html:1385
const ingresoConsol = () => S.ingresoBase + (usaAbaco() ? S.ingresoAbaco : 0);
// :1417  const directa = ingresoConsol() >= 3000000;
// :1406  R6: canon <= 0.25 * (ingresoConsol()/4.345)
// :1407  R7: (deudas + cuotaMes) <= 0.40 * ingresoConsol()
```

En el sistema real, Ábaco es un **gate de paso**, no un insumo de decisión. Verificado por tres lados:

| Fuente | Qué dice |
|---|---|
| `legacy-backend@feature/motai-v2` | `AbacoParserService` calcula y persiste `average_income` (`user_summaries.abaco`), y **ningún otro archivo del repo lo lee** (grep de `average_income` y `->abaco` fuera de vendor: sin consumidores). |
| Nodo `motai` del context (`doc.md:26`) | "**Ábaco NO decide (hoy)** — captura informativa, no cableada." |
| Simulador `flow` (`src/nodes/IngresosExtrasNode.vue:10`) | "Informativo: no cambia el cupo, la cuota ni la decisión (fiel al legacy)." |

Lo que Ábaco sí hace hoy: `POST motai/check-abaco-requirement` responde `MOTV1001` (requiere) o `MOTV1000`,
según `lenders.product === 'renting'`, y el front redirige a `/abaco` **desde el action de `/confirmation`**
(F-49 en el nodo `findings`). Es un paso obligatorio que hay que completar; el número que trae no mueve nada.

### Otras divergencias de `motai.html` (menores, pero cuestan tiempo)

- **Solo el `amount` vive en BD.** La migración real seedea `formulas: {amount: …}` para el lender 158; el
  canon semanal, la anualidad y la tabla RTO que calcula el prototipo **no** están en `lenders.calculator`.
- **Ojo con la colisión del 158.** El prototipo usa el 158 como **aliado** (el comercio Motai), que sigue
  siendo correcto. F-48 habla del **lender** 158 "Motai Renting" —otro namespace, otra tabla— que no está
  ofrecido en ninguna sucursal (nunca lista); el lender renting que sí lista es **#169 Motai R**. El
  prototipo no le pone id a sus productos, así que no hereda ese problema.
- **La cascada de ingreso** (AgilData → Mareigua → Quanto → Manual) se elige a mano con un radio; en el real
  la resuelve el backend.
- Falta la **tabla de amortización** del RTO que pide el PRD.

## `calculadora-formulas.html` — el más fiel de todos

Explica el mecanismo que reemplazó a la fórmula quemada en el frontend: cada lender guarda su fórmula en
la columna json `lenders.calculator` y el backend la corre en un procesador restringido. Editable en vivo,
con 3 presets (`credit` identidad · `renting` Motai · encadenado `amount` + `installment`) y una sección
"probá pegar algo malicioso" que muestra el rechazo de `alert(1)`, `window`, `amount.constructor`.

Contrastado contra el código real y **coincide**:

- `app/Support/FormulaCalculator.php` existe; sin `eval`, sin funciones registradas, con un `guard()` que
  restringe a números, variables del scope y `+ - * / % ** ( )`. Las fórmulas se evalúan **en orden** y cada
  resultado entra al scope de la siguiente (por eso `installment` puede usar `amount`).
- `null` / sin `formulas` → **identidad** (el default de todos los `credit`).
- La migración `2026_07_15_120000_add_motai_v2_columns.php` seedea al lender 158 exactamente
  `{"params":{"setup_fee":1500000,"margin":1.0,"tax":0.19},"formulas":{"amount":"(amount + setup_fee) * (1 + margin) * (1 + tax)"}}`,
  con el mismo ejemplo del PRD: `4.534.000 → 14.360.920`.

**Matiz honesto:** el demo dice "parser de aritmética". En el backend el motor es **Symfony ExpressionLanguage
sin funciones registradas + un guard por regex**; el efecto es el mismo (aritmética pura sobre escalares),
pero no es un parser escrito a mano. El parser a mano es el del HTML.

## `merchant-config/` — la propuesta del modelo de renting

Cinco piezas para la conversación con negocio (`propuesta.html`), la partición de la config en 3 niveles
(`niveles.html`), la separación comercio↔CreditopX (`index.html`), la consola de aprobación manual
(`admin.html`) y el recorrido paso a paso (`flow.html`). El detalle de cada una está en
[`merchant-config/README.md`](./merchant-config/README.md), que además trae una sección de honestidad
verificada contra código el 2026-07-06.

Dos cosas para leerlo con la fecha puesta:

1. **Parte de la propuesta ya se ejecutó.** "Productos = lenders del catálogo" y "la fórmula debería vivir en
   BD" dejaron de ser propuesta: son `lenders.product` y `lenders.calculator` en `feature/motai-v2`.
   El README interno todavía las describe como pendientes.
2. **Necesitan internet.** A diferencia de los tres de la raíz, los cinco cargan los íconos Tabler desde
   `cdn.jsdelivr.net`. Sin red se ven sin íconos (no rompe el layout, pero se nota).

## Docs relacionados

- [`merchant-config/README.md`](./merchant-config/README.md) — índice de los 5 prototipos + honestidad del 07-06.
- `../context/server/data/flows/motai/doc.md` — cómo funciona Motai **hoy** (incluido "Ábaco no decide").
- `../context/server/data/flows/motai-v2/doc.md` — qué cambió la des-motaización, commit por commit.
- `../context/server/data/flows/findings/doc.md` **§L** (F-46 a F-52) — la bitácora de depuración de Ábaco y
  renting en local. Si algo del renting no anda, se busca ahí **primero**.
- `../flow/` — el simulador Vue Flow (`npm run dev`, puerto 5190). Ahí Ábaco es el nodo
  "Información complementaria", informativo. **Es el que modela bien la regla.**
- `../EXAMPLES.md` (raíz del playground) — pese al nombre, **no** habla de esta carpeta: son comandos de
  demo del wizard real desde `frontend-e2e`.

## Punteros rotos conocidos (no arreglados)

- `merchant-config/README.md` línea 4 apunta a `../docs/mejoras/MOTAI-PLAN-EVOLUCION.md`. Doble rotura: la
  carpeta `playground/docs/` **fue borrada de `main`** (absorbida por el árbol de context) y, tras el movimiento
  a `examples/`, el `../` ya ni resuelve a la raíz. Recuperable con
  `git show 159906a:docs/mejoras/MOTAI-PLAN-EVOLUCION.md`; el sucesor vivo es el nodo `motai-v2` del context.
- Mismo README, línea 16: manda al target `merchant-config` de `.claude/launch.json`, que apunta a la ruta
  vieja y sirve 404.
