---
id: 45
title: "Cuotéalo BCP (Perú) — acoplar la entidad al flujo y hacerla administrable"
stage: work
created: "2026-08-10T09:00:00-05:00"
context_nodes: [entities, hardcodes-entidades, aggregator, ecommerce, onboarding, merchants, negocio, payments, dynamic-forms]
jira: [CORE-399]
jira_title: "Estructurar BCP para el flujo de registro"
---

# Cuotéalo BCP (Perú) — acoplar la entidad al flujo
> **estado:** 🔎 levantando información (encargo de Oscar, 2026-08-10). Nada implementado, sin rama.
>
> **El encargo, textual:** *«por ahora levanta información, revisa cómo es el flujo… la idea es que tú lo
> acoples a nuestro flujo y sea administrable, y que José haga toda la recolección de datos de los
> formularios dinámicos»*. O sea: **mi parte es el acople y la administrabilidad**, no la captura.
>
> Fuentes: **PRD «Integración de Cuotéalo BCP»** (Confluence 633208833, v1 2026-07-31) + **Figma de BCP** (leído por API el 2026-08-10). El PRD cita un documento hermano de preguntas abiertas
> (`preguntas-abiertas-bcp-ivan.md`) que **todavía no encontré**.

## Qué es Cuotéalo, en una frase
Un piloto **Creditop × BCP en Perú**: BCP tiene buena originación digital pero **débil en punto de venta**,
y Creditop aporta ese know-how. Arranca con **concesionarios Honda (5–10 comercios)**, canal **POS asesor**,
en dos flujos: **Consumo** y **Vehicular**.

**El reparto de responsabilidades es el dato que ordena todo el diseño:**

| | Creditop | BCP |
|---|---|---|
| Front de originación en POS | ✅ | |
| Motor de riesgo, política, preaprobado, KYC del cliente | | ✅ |
| Simulador (cálculo y render de la cuota) | | ✅ **embebido** |
| Generación y envío del link de pago | ✅ | |
| Login, 2FA y aceptación del cliente | | ✅ (CIAM) |
| Desembolso | | ✅ **a Creditop** |
| Abono al comercio (T+1) | ✅ | |
| Recaudo y cobranza | | ✅ |
| Administrador para el comercio | ✅ | |

⚠ **BCP es la ÚNICA entidad prestamista de esta fase**, y una segunda entidad está explícitamente fuera
del MVP.

## 🔴 El principio arquitectónico del que se derivan casi todos los problemas
**Creditop no puede leer el resultado del simulador: es un iframe de BCP.** De esa ceguera salen dos
piezas que parecen arbitrarias y no lo son:

1. **El gate manual** — una pantalla que le pregunta al asesor *«¿el cliente cuenta con una oferta
   preaprobada?»* con dos botones obligatorios. Es el **disparador técnico** para continuar y el **único
   punto donde se captura «sin preaprobado / negado»**, porque BCP solo notifica cuando aprueba. Es dato
   autoreportado, direccional, sin riesgo de fraude (BCP revalida al desembolsar).
2. **La re-captura de identidad** en un formulario propio de Creditop — no es redundancia: es la única
   forma de que el administrador del comercio tenga datos, ya que lo del iframe no se ve.

## Validación de lo que dice Oscar: ¿por qué esto es «parte de lo que estabas trabajando»?
**Tiene razón, y el vínculo es más fuerte de lo que él planteó: es un prerrequisito directo.** Pero
«es parte de lo mismo» **no significa «ya está resuelto»**. Verificado contra el código y la BD:

**Dónde se toca, exactamente.** El flujo de Cuotéalo **arranca con las dos pantallas que el PR de
internacionalización acaba de tocar**: celular (con el toggle de vehículo) y OTP. Ese PR hizo que
justamente esas pantallas lean el país del comercio en vez de asumir Colombia
(`routes/dynamic/request-phone.tsx`, `PhoneForm.tsx`, y del lado backend la resolución de país del
teléfono). Sin ese trabajo, la pantalla 1 de BCP saldría con **+57** para un cliente peruano.

**Y dónde NO alcanza.** La fila de Perú (`countries.id = 167`, activa) está incompleta, y el PR **no la
completa**:

| campo | Colombia | RD | **Perú** | consecuencia para BCP |
|---|---|---|---|---|
| `dial_code` | 57 | 1 | **vacío** | 🔴 la migración del PR pobla `phone_code` **desde acá** → Perú queda en NULL |
| `phone_code` | +57 | +1 | **NULL** | 🔴 la pantalla 1 no tiene prefijo que mostrar |
| `cell_phone_lenght` | 10 | 10 | **vacío** | no hay con qué validar el largo (el PRD pide «celular numérico») |
| `nationality` | COLOMBIANA | DOMINICANA | **NULL** | los documentos quedan sin nacionalidad |
| `locale` | es-CO | es-DO | **es_PE** ⚠ | guión **bajo**: rompe formateo, y Cuotéalo factura en **PEN** |
| ciudades | 1.123 | 8 | **0** | ningún selector de ciudad puede ofrecer nada |

**Conclusión de la validación:** el PR es condición necesaria y **no suficiente**. Lo primero de esta
tarea no es código: es **cargar los datos de Perú** (empezando por `dial_code = 51`) y arreglar el
`locale`, porque si no, el trabajo de internacionalización deja a Perú en NULL **en silencio**.

## Cómo acoplarlo: el patrón ya existe, invertido
La integración con Cuotéalo es un **POST con `FormData` y un único parámetro `data`** (JSON stringificado)
hacia el site del banco, con `redirectPath` para el éxito y `backUrl` para la cancelación, más
`ecommerceId` y `merchantId` que identifican al comercio.

**Eso es estructuralmente el mismo contrato de checkout que Creditop ya tiene en el canal ecommerce**
(contrato serializado + token + URL de retorno + URL de callback), **solo al revés**: hoy Creditop
**recibe** ese POST desde la tienda de un comercio; con BCP, Creditop **lo emite** hacia el checkout del
banco. No es un patrón nuevo que haya que inventar — es el de `ecommerce` espejado, y ya existe la pieza
que arma esos contratos.

**Lo que sí es nuevo y no tiene lugar hoy:**
- **La encriptación campo por campo** (RSA/ECB/SHA-256/MGF1Padding, 2048 bits; BCP entrega la pública por
  correo firmado, vigencia 2 años). Ninguna integración actual encripta campo a campo.
- **El vehículo como entidad de datos** — marca, modelo, versión, año, chasis, motor, seguro
  (BANA/ENDOSADO), valor, bono, comisión del dealer. La captura la hace José; **el modelo de datos y su
  administrabilidad son míos**.
- **El gate humano** en medio del flujo.
- **El flujo de fondos**: BCP desembolsa **a Creditop** y Creditop abona al comercio **T+1** — un tercer
  modelo económico, distinto de CreditopX (capital del comercio) y del agregador clásico (el lender le
  paga al comercio). Acá **Creditop toca la plata**. → ver `negocio`.

## Lo que el PRD ya define y no hay que preguntar
- **Comisión del dealer**: 0,1 %–6 %, tope 6 %, y **se suma al interés** en la tasa que se muestra.
- **La cuota mostrada incluye seguro + comisión** (sin sorpresas al cliente).
- **Documentos**: DNI / C.E. **OTP de 4 dígitos**, reenvío 4:48. **T&C y Política como DOS documentos con
  dos checkbox independientes**, tropicalizados a Perú, y **la aceptación se firma con OTP** — para que el
  asesor no pueda aceptar por el cliente.
- **Link de pago**: lo genera **Creditop** y va por **correo y WhatsApp simultáneamente**.
- **Sesión de Cuotéalo: 10 minutos** — la de Creditop **debe superarla**.
- **Administrador del comercio**: se ve como una pasarela de pago (documento del cliente, comercio, monto,
  punto de venta, estado del link). **Sin** datos del cliente ni del vehículo. Estados esperados:
  aprobado / abandonado / expirado.
- **Usuarios ilimitados por comercio**, cada asesor con credenciales propias (trazabilidad).
- **Endpoints**: producción `cuotealo.viabcp.com/inicio`; desarrollo, un Azure websites.
- **Topes de monto por comercio, parametrizables** (valores a negociar).

## Lo que dice el FIGMA (leído por API el 2026-08-10)
Archivo `6W7Q6X21JrhF9L95OMc3Pf`, dos páginas: **✏️ Flujo** y **📲 Protopipo**. Dentro de Flujo, dos
secciones: `Cuotéalo BCP` (30 nodos) y `cuotealo vehicular` (28). ⚠ Los nombres de los frames **no
sirven** de inventario —«Formulario», «-», «OPT»— así que el orden real se reconstruyó por su posición
en el lienzo, y las pantallas se leyeron renderizándolas.

**La secuencia vehicular de escritorio (1440 px), en orden:**

| # | Pantalla | node-id |
|---|---|---|
| 1 | Número de celular | `410:899` |
| 2 | OTP | `410:854` |
| 3 | Formulario del vehículo | `459:652` |
| 4 | **Simulador BCP embebido** | `410:689` |
| 5 | **Completa tu información 1/2** (identidad) | `410:635` |
| 6 | Formulario (2/2 esperado) | `410:1899` |
| 7 | Cierre / «finaliza en el celular» | `410:564` |
| — | **Rechazo** («Lo sentimos, no tenemos una opción…», con logo BCP) | `410:818` |

Las mismas 7 existen en **móvil (430 px)** como frames aparte → es **responsive con dos diseños**, no uno
adaptativo. Y hay un **segundo set espejado** (ids `602:*`) que probablemente sea el flujo Consumo o una
versión anterior: hay que preguntar cuál manda antes de tomarlo como fuente.

### 🎯 P7 QUEDA RESUELTO POR EL DISEÑO: es iframe
**Todas las pantallas están dibujadas dentro de un navegador cuya barra de direcciones dice
`admin.creditop.com`** — incluida la del simulador, que muestra el contenido de BCP («¡Al instante!
Descubre cuánto podemos pagar por ti», documento + fecha de nacimiento, con los logos de los retailers
peruanos) **ocupando el área de contenido de nuestra propia página**. No hay ninguna pantalla que salga a
`cuotealo.viabcp.com`.

Consecuencias directas:
- **P1 deja de ser una duda teórica y es EL bloqueante**: si BCP no autoriza `frame-ancestors`, esa
  pantalla no existe y hay que rediseñar el journey.
- **El gate manual se justifica** (somos ciegos al iframe), así que no es una pieza que se pueda recortar.

### 🔴 Y el gate manual NO ESTÁ DISEÑADO
El PRD lo exige —dos botones obligatorios, y es el **único** punto donde se captura «sin preaprobado»
porque BCP solo notifica al aprobar— pero **el Figma va del simulador (4) directo al formulario de
identidad (5)**. La pantalla de rechazo existe como rama aparte (`410:818`), no como gate. Sin esa
pantalla no hay funnel de rechazos, que es justo lo que el PRD quiere medir.

### ⚠ Y el diseño monta el flujo en `admin.creditop.com`
Hoy las audiencias están separadas por subdominio: el **asesor** vive en `aliados.{host}` y `admin.{host}`
es el **back-office**. El Figma pone el flujo POS del asesor en `admin.` Puede ser un placeholder del
diseñador, pero si es literal **cambia dónde se monta todo**: grupo de middleware, namespace y archivo de
rutas distintos. Hay que confirmarlo antes de escribir una ruta. → `application` §audiencias.

## 🔴 Los 7 bloqueantes, que son de BCP y no nuestros
Del §9 del PRD. Los dos primeros bloquean **cualquier prueba**:

| # | Qué falta | Por qué me bloquea |
|---|---|---|
| **P1** | Que BCP autorice el iframe (`frame-ancestors` + que `X-Frame-Options` no sea DENY) | sin esto el simulador no se puede embeber y el diseño entero cambia |
| **P2** | Whitelist de la IP de Creditop en el WAF de Cuotéalo | **el WAF solo permite IPs de Perú**; el equipo prueba desde Colombia → hoy no se puede ni probar en dev |
| ~~P7~~ | ~~¿iframe o redirect?~~ **El Figma lo resuelve: es IFRAME** (todas las pantallas dentro de `admin.creditop.com`). Queda pedirle a BCP que lo confirme por escrito, porque su manual dice redirect | ya no bloquea el diseño; sí hay que alinear a BCP |
| P3 | Valor de `hasDetail` en vehicular | el manual dice `false`, el ejemplo manda `true` |
| P4 | Estructura definitiva de los objetos del vehículo (pedir Swagger) | la tabla los pone en raíz, el ejemplo dentro de `productDetails[]` |
| P5 | Enum completo de `creditStatus` + cómo detectar abandono/expiración | **el administrador necesita esos estados y BCP hoy solo confirma aprobación** |
| P6 | Cuándo se capturan cuota inicial y valor a financiar | contradicción entre manual y reunión |

⚠ **Con P7 resuelto por el diseño, el que más cuesta ahora es P1**: sin la autorización del iframe, la
pantalla del simulador —que es el corazón del flujo— no existe. Y **P2 sigue impidiendo cualquier prueba**
mientras el WAF solo acepte IPs de Perú.

## Mis preguntas (las que quedan después de leer el PRD)
- [ ] **¿Perú entra como país completo o como parche para BCP?** Cargar `dial_code`, `nationality`,
  `cell_phone_lenght`, arreglar el `locale` y sembrar ciudades es la base de todo. ¿Va en esta tarea o
  como continuación de la internacionalización?
- [ ] **¿BCP entra por el MS de pre-aprobaciones o por el switch legacy por id?** Es la decisión que
  define si esto suma el hardcode número 25 o si es la primera entidad que entra por el patrón nuevo.
  ⚠ Ojo: acá la pre-aprobación **no la calculamos nosotros** (es el iframe), así que puede que ninguno de
  los dos aplique y sea un canal aparte.
- [ ] **¿El «administrador para el comercio» se construye nuevo o es el panel que ya existe?** La capa de
  configuración ya tiene API sin front (→ `application` §5) — esto podría ser su primer consumidor.
- [ ] **¿Dónde vive el vehículo?** Tabla propia, EAV vía formularios dinámicos (lo de José), o
  `user_request_products` como SmartPay. Decide qué se puede reportar después.
- [ ] **¿Cómo se prueba sin IP peruana?** Mientras P2 no se resuelva, no hay forma de ejercitar el
  simulador. Hay que decidir si se mockea (y entonces el harness necesita un mock de Cuotéalo) o si se
  espera.
- [ ] **¿Qué pasa con el consentimiento firmado por OTP** frente a lo que ya hace el flujo actual? El PRD
  lo pide explícitamente para que el asesor no acepte por el cliente.

## Tarea (publicable)
_Pendiente. CORE-399 está sin descripción en Jira y el encargo de esta fase es levantar información: no
se publica nada hasta cerrar al menos P7 (iframe vs redirect) y decidir por dónde entra la integración._

## Bitácora
- **2026-08-10** — Bajada de Jira. CORE-399 llega **sin descripción, sin puntos y sin comentarios**; el
  épico `CORE-331` también está vacío, y sus 13 historias son lo único que describía el flujo. Medido el
  punto de partida: **BCP no existe en el código** (cero archivos) y **Perú existe como país pero
  incompleto**.
- **2026-08-10 (2)** — Leído el **PRD de Confluence** que pasó Oscar, y con eso se contestaron cinco de
  las siete preguntas que había abierto a ciegas: BCP hace riesgo/KYC/cartera/recaudo y es la **única**
  entidad; el link de pago **es nuestro**; el comercio son **concesionarios Honda**; el simulador es un
  **iframe** (con P7 abierto); y la captura del vehículo es de José. **Validada la afirmación de Oscar**:
  el PR de internacionalización es prerrequisito **directo** —el flujo de BCP arranca con las dos
  pantallas que ese PR tocó— pero **no suficiente**: la migración pobla `phone_code` desde `dial_code`, y
  el de Perú está vacío, así que deja a Perú en NULL sin avisar. Hallazgo de acople: el contrato de
  Cuotéalo (POST con `data` JSON + `redirectPath`/`backUrl` + ids de comercio) es **el mismo patrón del
  checkout de ecommerce que ya tenemos, invertido** — no hay que inventarlo. Y el flujo de fondos es un
  **tercer modelo económico**: BCP desembolsa a Creditop y Creditop abona al comercio T+1.
- **2026-08-10 (3)** — **Leído el Figma por API.** Los nombres de los frames no sirven de inventario, así
  que el orden se reconstruyó por posición en el lienzo y las pantallas se leyeron renderizándolas. Tres
  hallazgos:
  - **P7 queda resuelto por el diseño: es IFRAME.** Todas las pantallas están dibujadas dentro de un
    navegador cuya URL dice `admin.creditop.com`, incluida la del simulador, que muestra el contenido de
    BCP ocupando el área de nuestra propia página. Ninguna sale a `cuotealo.viabcp.com`. Eso convierte a
    **P1 (autorización del iframe) en EL bloqueante**: sin eso, el corazón del flujo no existe.
  - 🔴 **El gate manual NO está diseñado.** El PRD lo exige y es el único lugar donde se captura «sin
    preaprobado», pero el Figma va del simulador directo al formulario de identidad. La pantalla de
    rechazo existe como rama aparte, no como gate. Sin el gate no hay funnel de rechazos — que es
    justamente lo que el PRD quiere medir.
  - ⚠ **El diseño monta el flujo del asesor en `admin.creditop.com`**, y hoy el asesor vive en
    `aliados.{host}` mientras `admin.` es el back-office. Si es literal y no un placeholder, cambia
    subdominio, middleware, namespace y archivo de rutas.

  Anotado además que el set de pantallas existe **dos veces** (escritorio 1440 y móvil 430: responsive con
  dos diseños, no adaptativo) y que hay un **segundo set espejado** cuya vigencia hay que preguntar antes
  de usarlo como fuente.
