# Cálculo y política — dos cosas, no una

> **Estado: aparcado.** Lo de acá está pensado y en parte implementado (la pestaña *Política* del
> prototipo funciona), pero el foco se movió a la **entrada**. Este documento existe para que no
> haya que redescubrirlo.

## La partición

| | **calculadora** | **políticas** |
|---|---|---|
| Contesta | *¿cuánto?* | *¿se puede?* |
| Devuelve | **números** | **un veredicto + su motivo** |
| Sabe de | aritmética | umbrales de negocio |
| Ejemplo | `cuota = 127.815` | `rechazado · R4 · el canon no llega al mínimo` |

Un `if()` en una fórmula **no es una política**: es selección de un parámetro (elegir el factor de
un plan). Una política tiene dos caminos de verdad, el orden importa, y el resultado no es un
número.

## No la inventamos nosotros

El PDF de Alta Fleet nombra **dos motores separados**, y son exactamente estas dos capas:

| lo que dice el documento de Manuela | lo que es acá |
|---|---|
| "Motor de Viabilidad — **Políticas Rudas** (filtro automático)": edad, listas restrictivas, rechazo automático con mensaje | el **`gate`** |
| "Motor de **Decisión Crediticia** — Políticas de Crédito": genera monto aprobado, tasa y condiciones | el **`outcome`** |
| "**Registro trazable** de cada decisión (scorecard, **variables usadas**, resultado)" | `evidence` + `evaluated` |

## Por qué son recursos separados y no un solo documento

Por la **cardinalidad cruzada**, que es un hecho verificado y no una preferencia de diseño:

- `motai-renting` y `motai-rto` son **dos hojas** que comparten **una** política — el PRD lo dice
  explícito ("mismas reglas de validación").
- `creditopx-salud` es **una hoja** para **tres comercios** (Sonria / Dentix / Gaes).
- Alta usa **el mismo flujo** de Motai con **su propia** política de riesgo.

Ninguna relación es 1:1. Meterlas en un documento obligaría a duplicar uno de los dos lados.

## La estructura de una política

```
constants   los umbrales                    minCreditScore 400 · maxIncomeShare 0.25
inputs      qué necesita                    weeklyRent (de la hoja) · monthlyIncome · creditScore
derived     lo que calcula para decidir      weeklyIncome · incomeShare
gate        TODAS deben pasar, corta en la primera que falla
outcome     PRIMERA rama que matchea gana
```

**El gate corta.** Si R4 falla, R5 y R6 **no se evalúan** — y eso se ve en el árbol: quedan en gris
"no se evaluó". Importa porque el motivo que se le informa al cliente es el de la regla que cortó,
no una lista de todo lo que estaba mal.

**El outcome no corta: clasifica.** La primera rama que matchea gana, así que el orden es la
prioridad.

Cada regla lleva su mensaje con interpolación (`{incomeSharePct|1}%`), para que el porqué salga del
documento y no de código de presentación.

## Cómo se enchufan sin conocerse

La hoja produce `weeklyRent`. La política pide `weeklyRent`. **Mismo nombre, porque los dos salen
del mismo diccionario** — así que no hay tabla de traducción. El servicio corre la hoja, junta sus
resultados con los inputs originales en una bolsa, y corre la política tomando de ahí lo que declara.

Ese es el pago grande del diccionario compartido, y no era obvio: no era solo evitar el typo
`taza`/`tasa`, es lo que **hace que las piezas se enchufen solas**.

El encadenado vive en el **request**, no dentro de ningún documento:

```http
QUERY /api/evaluate
{ "inputs": { … },
  "run": [ { "sheet": "motai-rto", "with": { "termMonths": 18 }, "then": "motai" } ] }
```

Ni la hoja ni la política saben que existe la otra. Mañana alguien corre `motai-rto` contra la
política de Alta y ninguna se entera.

## Lo que la política NO hace

- **No calcula el plazo.** Lo *descarta*. Con un ingreso de 3.200.000: a 12 meses cae por R6 (la
  cuota se lleva el 31,3%), a 24 cae por R4 (el canon no llega al mínimo), y solo 18 pasa. Los tres
  plazos existen; la política dice cuáles sobreviven. Por eso la calculadora corre **una vez por
  plazo** y la política juzga cada resultado.
- **No mira fechas.** El calendario es del llamador.
- **No decide sola el rechazo final.** En Alta la pantalla de decisión la maneja un Admin, no el
  asesor (punto de la "Diferencia principal frente al flujo Motai").

## Pendiente cuando se retome

1. **La política de Alta no existe todavía** — el PDF dice que tiene la suya, pero no la detalla.
2. **El hueco de la tabla de perfiles de Motai**: "≥3.000.000 → directa" y "<2.900.000 →
   condicional" dejan la banda **2.900.000–2.999.999** sin regla. Hoy la mandamos a
   `revision_manual` con nota, en vez de dejarla caer en silencio. Confirmar con Manuela.
3. **`Score mínimo titular` se contradice** en el PRD: R3 dice **400**, la sección 5 dice **0**.
   Usamos 400.
4. **El techo de usura como dato, no como constante.** Si la política va a validarlo, la tasa de
   usura la publica la Superfinanciera cada trimestre — entra como input o tabla con vigencia,
   nunca cableada. Y solo aplica a las hojas con `legalNature: 'crédito'` (ver `motai` en context).
5. **`rateConvention` en el lint**: si una hoja declara `effective` pero el `rate_suffix` del lender
   dice `N.M.`, avisar. Es literalmente CORE-127 / F-71.
