# De "Motai" a renting genérico — qué encontramos y cómo lo ejecutamos

> **Para quién:** Manuela (Dir. Producto), Jose (análisis de brechas) y el equipo técnico.
> **Qué es:** el plan de ejecución para **sacar el código atado a Motai** y dejar el renting como una
> capacidad que **cualquier comercio** pueda ofrecer por configuración — sin reprogramar.
> **Estado:** propuesta lista para alinear. Nada en producción todavía. Verificado contra el código
> real (rama `staging` de ambos repos, 2026-07-12).
>
> Las notas **🔧 Técnico** son detalle opcional para desarrollo; el texto principal es para todos.

---

## 1. En una página

**El pedido:** hoy el flujo de renting funciona, pero **está hecho a la medida de un solo comercio
(Motai)**: su nombre, precios, documentos, reglas e identificadores están escritos dentro del código,
en muchos lugares. Sumar un segundo comercio (Alta, y los que vengan) hoy es "volver a programar", no
"dar de alta". Eso frena capturar el nuevo negocio (**~40M/mes** estimados en el PRD).

**La propuesta, en una frase:** en vez de un "modo Motai" escondido, los productos (compra / renting /
renting con compra) son **opciones de un catálogo**, y su comportamiento lo define el **tipo de
producto** — cada comercio se configura llenando una **ficha**, sin tocar código.

**Tres cosas importantes:**
1. **No se reconstruye el sistema.** Se reutiliza casi todo; se ordena, se saca lo clavado y se
   agregan pocas piezas nuevas.
2. **Es más fiel a cómo ya funciona el sistema.** El resto de los productos ya se comportan según su
   tipo; Motai es la excepción que lo hace por un atajo. Esto lo alinea con los demás.
3. **Motai nunca deja de funcionar.** El cambio entra por pasos, cada uno probado; los identificadores
   viejos se borran recién al final.

---

## 2. Qué encontramos (verificado contra `staging`)

Hicimos un censo del código atado a Motai en los dos repositorios, **rama por rama, línea por línea**,
y confirmamos que **todo vive en `staging`** (no es de una rama suelta). El detalle completo con cada
archivo y línea está en el [documento técnico](DES-MOTAIZACION.md); acá el resumen digerible:

| Dónde | Cuánto | Qué tipo de cosa está clavada |
|---|---|---|
| **Backend** (legacy) | ~18 puntos | El interruptor `isMotaiRenting` que salta el buró, el id de modo `= 2` (sin registro de origen), los términos y condiciones repetidos, el envío de documentos atado a otro lender (Credifamilia), y el filtro de entidades que hoy no hace nada |
| **Frontend** | ~17 puntos | El id de la entidad `158` (repetido en **2** archivos), la **fórmula de precios duplicada**, el texto del "modo" en 6 pantallas, el logo/colores/PDFs de Motai quemados, y datos como "nacionalidad venezolana" fijos |
| **Repo viejo** (application) | 0 | Sin lógica Motai — solo texto de marketing |

**La buena noticia:** no es un desorden aleatorio. Es **un solo patrón** ("preguntar si es Motai por
un identificador fijo") repetido en muchos lugares. Cambiar el patrón una vez, bien hecho, los
resuelve casi todos de una. De hecho el mismo anti-patrón aparece con otros comercios sueltos
(ids `313`, `160`), así que la solución los ordena de paso.

> **🔧 Técnico:** backend B1–B18, frontend F1–F17 (nomenclatura del doc técnico). Hallazgos que
> corrigen el diagnóstico previo: (a) el ingreso que captura Ábaco (`average_income`) **ni siquiera se
> persiste** — se calcula y se descarta; (b) el id `158` **no existe en el backend** (el acople por id
> es solo del front); (c) la tabla `allied_modes` **no tiene seeder** — la fila del modo se inserta a
> mano. El flujo de bloqueo de celulares (IMEI/device-lock) está **limpio** — no se cruza con esto.

---

## 3. El cambio: quitar el "modo", crear el catálogo

| Quitar (lo clavado) | Reutilizar (ya existe) | Crear (nuevo) |
|---|---|---|
| El interruptor `isMotaiRenting` y el "modo" escondido | El motor del flujo: registro, identidad, firma, desembolso | La **categoría del producto** (arrendamiento vs crédito) que dispara el comportamiento |
| Los ids y textos de Motai clavados | El catálogo de entidades y su **motor de reglas** (ya tiene pantalla de admin) | El **cálculo de precio en el backend** (una sola fuente, hoy está duplicado en pantalla) |
| La fórmula de precio en la pantalla (duplicada) | La validación de ingresos por apps (**Ábaco**), ya construida | La **ficha por comercio** (qué ofrece, marca, cómo decide) |
| La pantalla de "modos" confusa | El patrón legal de firma (hoy para Credifamilia) | El **codeudor** y la **pantalla de decisión** del comercio *(fases siguientes)* |

> **🔧 Técnico:** "el comportamiento lo dispara la categoría" = reemplazar `if id == 158` /
> `isMotaiRenting` por `if categoria == 'arrendamiento'`. Los productos pasan a ser **lenders
> CreditopX** del catálogo (rt=2), hermanos de CrediPullman/SmartPay. La config vive **por lender**
> (reglas, precio, documentos — tablas existentes + extensiones); la ficha del comercio queda flaca
> (marca + qué lenders habilita + cómo decide). ⚠️ La "categoría de lender" **hay que construirla** —
> hoy no existe un campo que clasifique lenders; ese es el corazón del trabajo y lo que finalmente
> mata el hardcode.

**Para verlo funcionando:** el simulador interactivo (`playground/flow`) ya modela este destino — los
productos son un atributo de la entidad en el catálogo, las reglas viven por nivel con herencia, y el
ciclo de vida se ramifica por tipo. Sirve para alinear sin leer código.

---

## 4. Cómo cubre el PRD (MVP2 de Manuela)

Casi toda la política del PRD es **configuración, no código nuevo**. La traducimos así:

| Lo que pide el PRD | Cómo lo cubre este modelo |
|---|---|
| Simulador de renting / rent-to-own | Precio y planes en la **ficha** (configurable), calculado en backend — no quemado en pantalla |
| Política de riesgo (R1–R8) | Reglas con **clave estable + valor**, cargadas en el motor de reglas que ya existe |
| Política por perfil (App / No-App) | Es **una misma regla con otra fuente de ingreso**: App → Ábaco; No-App → AgilData/Mareigua/TusDatos. No hay código por perfil |
| Rangos de cuota / canon ($150k–$300k) | Tabla de topes por perfil en la config |
| Codeudor (obligatorio si ingreso < $2.9M, score > 650) | Pieza **nueva** (modelo + flujo + regla) — fase del motor de decisión |
| Documentos de formalización | Por producto: renting = contrato + pagaré; rent-to-own = **+ garantía mobiliaria** |
| Cobranza semanal / reporte a Motai | **Fase siguiente** (es operación post-desembolso, otro flujo) |

> **🔧 Técnico:** las R1–R8 se reescriben como claves estables (`datacredito.score_min`,
> `capacity.dti_monthly_max`, `cosigner.required_below_income`…) porque las "Rn" son posicionales.
> Requisito bloqueante de toda la política: **persistir y cablear `average_income` de Ábaco**, que hoy
> se descarta.

### ⚠️ Hallazgo importante para Manuela — la calculadora de rent-to-own

Al verificar la calculadora del PRD (`Calculadora Renting VF.xlsx`) contra las cuotas de ejemplo,
encontramos que **la columna "Semanas" está mal**:

| Plazo | Dice el PRD | Debería decir | Por qué |
|---|---|---|---|
| 12 meses | 12 semanas | **52 semanas** | La cuota de ejemplo ($230.997) solo cierra con **12 meses de pagos semanales** = 52 semanas |
| 18 meses | 18 semanas | **78 semanas** | ídem ($162.078) |
| 24 meses | 24 semanas | **104 semanas** | ídem ($127.815) |

Lo verificamos con la fórmula de amortización (tasa 1,8% mensual ≈ 0,4125% semanal sobre $10.790.920).
No es un problema del sistema — es un dato a corregir en el PRD/Excel antes de programar el simulador.
**Manuela: ¿confirmás que son meses (52/78/104 semanas) y no semanas?**

---

## 5. El plan de ejecución

Se entrega en **PRs chicos**, cada uno probado, con la regla de oro: **Motai sigue funcionando en
todo momento** (el mecanismo nuevo entra "leyendo con respaldo" al viejo; los ids se borran al final).

| Fase | Qué hace | Resultado |
|---|---|---|
| **0. Saneamiento** | Arreglar lo roto/desconectado (endpoint muerto, webhook, persistir el modo y el ingreso de Ábaco) + poner el registro base del modo con seeder | Terreno confiable |
| **1. Categoría de producto** | Crear la categoría que dispara el comportamiento; los evaluadores la leen con respaldo a los ids viejos | El comportamiento deja de depender del id |
| **2. Precio a backend** | Una sola fórmula de precio (config por producto); la pantalla solo la muestra | Se elimina la duplicación |
| **3. Legal por config** | Términos, condiciones y plantillas de documentos por comercio/producto | Cada comercio sus documentos, sin código |
| **4. Reglas por config** | Buró / fuentes de ingreso / tipos de documento leídos de la ficha (con cuidado especial en riesgo) | El underwriting es configurable |
| **5. Front sin textos de "modo"** | Las pantallas leen la config; marca y datos por comercio | El front deja de "saber" de Motai |
| **6. Borrar lo clavado** | Caen los ids, el interruptor y la pantalla de modos | Cero hardcode Motai |
| **7. Prueba de fuego** | Dar de alta un 2º comercio (**Alta**) **solo con configuración** | Si algo pide código, es una brecha a corregir en las fases 1–6 |

**Criterio de éxito:** un comercio nuevo entra llenando una ficha; buscar "motai" en la lógica de
negocio no devuelve condicionales, solo datos; la calculadora tiene una sola implementación.

---

## 6. Cómo cierra las 11 brechas de Jose

El análisis de brechas de Jose (Alta vs Motai Renting v1) queda cubierto así:

| Brecha de Jose | Dónde se resuelve |
|---|---|
| 4.1 Términos y condiciones dispersos | Fase 3 (config legal) |
| 4.2 PEP en front y backend | Fases 4 y 5 (tipos de documento por config) |
| 4.3 El "modo" viaja por la sesión del front (frágil) | Fases 0 y 4 (el backend deriva del modo **persistido**, no del texto por request) |
| 4.4 Calculadora quemada y **duplicada** | Fase 2 (una sola fuente en backend) |
| 4.5 Envío de documentos atado a Credifamilia | Fase 3 (plantillas por comercio) |
| 4.6 Plantillas en S3 + microservicio de firma | Fase 3 |
| 4.7–4.11 El **administrador** decide (rol, acceso, pantalla, notificación) | **Fase aparte** (actor administrador) — este pedido deja el terreno listo, pero es su propio workstream |

> **🔧 Técnico:** las brechas 4.1–4.6 son exactamente el des-hardcodeo (fases 1–6). Las 4.7–4.11 son
> el "actor administrador": hoy la decisión entra por un endpoint sin autenticación propia
> (`BackDoorUserService`) que la toma el **asesor**; moverla a un administrador con rol y auditoría es
> el tramo más pesado y va como proyecto separado (con prototipo de referencia en
> `playground/merchant-config/admin.html`).

---

## 7. Decisiones pendientes (necesitamos definición)

| # | Pregunta | Dueño |
|---|---|---|
| **C10** | La calculadora de rent-to-own: ¿los plazos son 52/78/104 semanas (= 12/18/24 meses)? (§4) | **Manuela** |
| C9 | Score mínimo del titular: el PRD dice **400** en un lado y **0** en otro | **Manuela** |
| — | La fórmula de la **tarifa base** del renting (vive solo en el Excel anexo) | **Manuela** |
| PEP | ¿"Consultar Datacrédito al 100%" (R2) aplica también a los PEP? (existen justamente porque no tienen historial) | **Negocio / Compliance** |
| D6 | ¿El cliente elige el producto en el catálogo (y desaparece la pantalla de "modos")? | **Negocio / Diseño** |
| D7 | ¿Renting y rent-to-own son **dos** opciones del catálogo o **una** con casilla "opción de compra"? (misma política) | **Negocio** |
| — | ¿El reporte Excel a Motai existe fuera del código, o lo reemplaza el panel del administrador? | **Manuela** |

---

## 8. Qué NO entra en este pedido (para no vender de más)

- **La pantalla y el rol del administrador** (login, permisos, auditoría) — workstream aparte.
- **El motor de decisión automático** (política R1–R8 + codeudor corriendo solos) — fase siguiente;
  este pedido deja la config lista para cargarlo.
- **La cobranza semanal por WhatsApp** y el reporte a Motai — es operación post-desembolso.
- **El bloqueo de celulares** (IMEI/device-lock) — flujo separado, no se toca.

---

## 9. Documentos de referencia

| Doc | Para qué |
|---|---|
| [DES-MOTAIZACION.md](DES-MOTAIZACION.md) | El censo técnico completo (cada archivo:línea) + el plan de PRs detallado |
| [MOTAI-PLAN-EVOLUCION.md](MOTAI-PLAN-EVOLUCION.md) | El plan maestro por etapas E0–E4 y el diseño de arquitectura |
| [MODELO-RENTING-PROPUESTA.md](MODELO-RENTING-PROPUESTA.md) | La versión conceptual (hoy vs deber-ser del renting) |
| Prototipos `playground/merchant-config/` | La ficha del comercio + la consola de decisión del administrador |
| Simulador `playground/flow` | El destino funcionando: productos como catálogo, reglas por nivel, ciclo de vida |

---

**En una línea:** Motai está clavado en ~35 puntos de los dos repos, pero es **un solo patrón**
repetido; lo reemplazamos por **categoría de producto + ficha por comercio**, reutilizando casi todo,
por pasos que nunca rompen Motai — y así cualquier comercio puede ofrecer renting llenando una ficha.
