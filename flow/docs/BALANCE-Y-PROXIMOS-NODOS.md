# Balance del simulador visual — qué logramos, qué falta y los próximos nodos

> **Para quién.** Cualquiera del equipo (negocio, producto, soporte, tech) que quiera entender qué es
> el simulador `flow`, qué tan completo está frente a **todo** lo que contempla CreditOp, y hacia
> dónde conviene crecerlo. Sin jerga: el detalle técnico vive en [MAP.md](MAP.md) (el mapa del código
> real) y [DOCUMENTATION.md](DOCUMENTATION.md) (campo por campo).
>
> **Base.** Auditoría de cobertura del 2026-07-11: 13 dimensiones del negocio, cada una evaluada y
> luego verificada de forma independiente contra el código del simulador y los documentos maestros
> de `docs/`. Esto es la traducción a lenguaje de negocio.

---

## 1. Qué es esto (en un párrafo)

El simulador es **documentación que se puede tocar**. En vez de leer un manual, ves el camino de una
solicitud de crédito como un mapa de nodos conectados — el cliente, el comercio y su sucursal, los
burós que traen los datos, las reglas que filtran, el perfilamiento que asigna categoría, y el
listado final de opciones. Cada nodo es **editable**: cambiás el monto, el documento del cliente,
una regla de score, o "apagás" un buró — y ves **en vivo** qué entidades aparecen, cuáles se caen y
**por qué** (cada rechazo dice su motivo). Las reglas no son inventadas: replican el mecanismo del
sistema real, verificado contra el código.

---

## 2. Qué se logró

### a) El corazón de la decisión, fiel al sistema real

La parte que **decide** — la que explica la mayoría de los "¿por qué no le salió tal entidad?" —
está modelada con fidelidad:

- **La cadena comercio → sucursal → entidades.** Qué ofrece cada sucursal y cómo eso arma la base
  del listado.
- **Las reglas por sucursal** (score, mora, consultas al buró, edad, ingreso, tipo de documento…),
  con la distinción clave del negocio: si una entidad **CreditopX** no cumple, **se cae del
  listado**; si una **externa** no cumple, **baja al fondo** como "probabilidad baja" pero sigue
  visible.
- **El perfilamiento por categorías** — el mecanismo real que decide **enganche, cupo y plazo** en
  CreditopX: el cliente cae en la primera categoría cuya regla cumple (ocupación, edad, ingreso,
  historial…), y esa categoría trae sus condiciones. Con lista negra de documentos y el cupo
  calculado igual que el real (fondo disponible, enganche que infla, capacidad de pago que topea).
- **El tramo por monto** — el último ajuste: según cuánto pide el cliente, se recortan los plazos y
  se topea el cupo.
- **La cuota, centavo a centavo** — fiel al pagaré real: capital financiado + costos administrativos
  + fondo de garantías (con su IVA) → cuota francesa + seguros. Con el desglose visible.
- **Los burós como nodos** — Experian/Datacrédito (el único que da score), TusDatos (identidad y
  listas), ÁgilData, Mareigua y Ábaco (ingresos). Podés simular "este dato no vino" o "se cayó la
  API" y ver el efecto real (sin dato = no pasa, como en producción).
- **La frontera del negocio**: CreditopX (decidimos nosotros → todo simulable) vs agregadores
  (decide la API del banco → un switch aprueba/rechaza/timeout, porque en la vida real tampoco lo
  controlamos).
- **La formalización después de elegir** *(nuevo)* — al seleccionar una entidad, a la derecha
  aparece su **ciclo de vida hasta el desembolso**, ramificado por tipo: CreditopX corre local
  (plan de pagos → KYC biométrico → firma del pagaré → cobro del enganche → **Estado 11**), el
  agregador **formaliza afuera** (radicación → decisión de su API → radicado/rechazado/timeout), y
  el redirect se va a su sitio (desenlace desconocido). Un stepper estilo "GitHub Actions": tocás el
  círculo de un paso para simular que falla y ves dónde se corta y cómo queda el **estado del
  crédito**. Cierra el arco: de "nace la oferta" a "el crédito existe (o no) y por qué".

### b) La documentación que lo respalda

- **[MAP.md](MAP.md)** — el mapa del flujo real en 6 etapas (alta → asociación → inicio → burós →
  consolidación), con el archivo y la línea exacta de cada paso. Verificado con doble revisión.
- **[DOCUMENTATION.md](DOCUMENTATION.md)** — qué campo del admin hace qué de verdad. De acá salieron
  los **campos fantasma**: cosas que el admin pide y el sistema nunca usa (IVA configurable,
  castigo, múltiplo del ingreso…), y la trampa de "Cuota mín/máx" (no es plata: es **cantidad** de
  cuotas).
- **[FAQ-SOPORTE.md](FAQ-SOPORTE.md)** — los dolores reales de #tech-ops explicados con el mapa:
  causa probable + qué revisar + a quién escalar, con nivel de confianza.

### c) Hallazgos que ya pagaron el esfuerzo

- Para el producto insignia (CreditopX), **gran parte de la config del comercio es cosmética**:
  manda la categoría de perfilamiento. Explica contradicciones que veníamos arrastrando.
- Las reglas **se copian por sucursal** al habilitar una entidad (≈37 mil copias, con deriva y
  copias huérfanas) — hallazgo con impacto directo en soporte ("comercio sin opciones").
- El patrón de fondo de los reclamos: **"lo que se muestra no es lo que decide el punto de venta"**
  — hoy el FAQ lo explica; el simulador todavía no lo muestra (ver §4).

---

## 3. La foto honesta: cuánto cubrimos

**El alcance es ORIGINACIÓN** (de que nace la solicitud hasta el desembolso / Estado 11). El
**servicing** post-desembolso — cuotas, mora, cartera, cobranza — es **otro grafo, fuera de alcance
por decisión** (ver nota al pie de la tabla). Sobre ese alcance de originación medimos dos cosas:

- **Lo que el simulador MODELA** (lo tocás y ves el efecto): **~35%**.
- **Lo que los documentos de flow EXPLICAN** (MAP + DOCUMENTATION + FAQ): **~57%**.

Con la **formalización** ya construida, el simulador cubre el **arco entero de una solicitud**:
nace la oferta → se decide → se firma → se desembolsa (o se detiene, y dónde). El salto reciente
vino casi todo de "Firma y desembolso" (15% → ~50%).

| Zona del negocio | Simulado | Documentado | En criollo |
|---|---|---|---|
| Cuota y matemática financiera | 🟢 56% | 🟢 66% | Lo que paga el cliente, fiel al pagaré real |
| Burós y datos de riesgo | 🟢 51% | 🟢 73% | De dónde salen los datos que deciden |
| **Firma y desembolso** | 🟢 ~50% | 🟢 ~55% | **El ciclo de vida post-selección, ramificado por rt** *(nuevo)* |
| El armado del listado | 🟡 43% | 🟢 87% | El corazón: bien simulado, documentado casi entero |
| Tipos de entidad (quién decide) | 🟡 ~47% | 🟢 52% | CreditopX y agregadores sí (incl. su post-selección); rotativo y Credifamilia no |
| Productos (crédito/renting/RTO) | 🟡 34% | 🟡 30% | El riesgo por producto sí; SmartPay no |
| Economía del negocio | 🟡 33% | 🟢 56% | Comisión, IVA, enganche: fieles |
| Alta y configuración (admin) | 🟡 31% | 🟢 76% | Las reglas resultantes sí; el back-office que las produce, no |
| Modo del comercio | 🟡 26% | 🔴 10% | Reducido a "producto"; falta el modo real y su paso Ábaco |
| Nacimiento de la solicitud | 🔴 13% | 🟢 66% | La "Solicitud" es un formulario; falta registro/OTP real |
| Arquitectura (sistema viejo ↔ nuevo) | 🔴 ~14% | 🟢 52% | Invisible en el grafo (a propósito) |
| Canales de entrada | 🔴 8% | 🟡 30% | Ecommerce / asesor / Alkosto: hoy solo etiquetas |

🟢 ≥ 50% · 🟡 20–49% · 🔴 < 20%

> **Fuera de alcance (servicing):** *Vida del crédito / cartera* (post-desembolso: cuotas, mora,
> cobranza revolving) es una segunda máquina de estados que corre después del Estado 11 y vive
> mayormente en `application`. Es un grafo aparte; **no cuenta** en los porcentajes de arriba.

---

## 4. Qué falta (los grandes que quedan)

> El **arco de salida ya está** (formalización → firma → enganche → Estado 11 + estado del crédito,
> §2). Lo que sigue abierto para completar la **originación**:

1. **La segunda evaluación (el dolor nº 1 de soporte).** Cuando el cliente confirma en el punto de
   venta, el sistema **vuelve a evaluar todo** (crédito activo, reglas, categoría, cupo) y puede
   decir otra cosa que el listado. Ese "lo que viste ≠ lo que decide" es el reclamo más frecuente
   (FAQ A1). La formalización que ya hay **asume que seguís**; falta modelar ese **re-chequeo** en el
   POS y compararlo contra el snapshot del listado. *Es el que más subiría la aguja.*
2. **El antes: cómo nace la solicitud.** El link/QR de la sucursal, el registro del celular, el
   código OTP, la solicitud que se recicla si ya existía. Explica dolores frecuentes ("no llega el
   OTP", "el usuario ya existe").
3. **Los canales.** Cómo entra la venta (asesor con QR, ecommerce WooCommerce/VTEX, Alkosto por
   lotes) y cómo se le avisa a la tienda al cerrar. Hoy son solo nombres de sucursal.
4. **Los productos que faltan.** SmartPay entero (celular como garantía + bloqueo remoto), el cupo
   rotativo, y Credifamilia con su radicación asíncrona (ver §6).

**Ajustes de fidelidad** (baratos; correcciones a lo que ya hay, no nodos nuevos). Estado tras la
auditoría del 2026-07-22 (verificada contra código real + pase adversarial):

- ✅ **Cuotas condonadas** — *resuelto*: el runtime ya es fiel (el campo de config es servicing, no
  baja la oferta; la baja real la hace `promotions_by_lenders`). Quedaba stale solo en los docs.
- ✅ **Etiqueta rt=4** — *corregido*: era "Híbrido" (nombre inventado, no está en el código); rt=4 es
  "gestión externa / SOAP" y su único inquilino real es Credifamilia (lender 24). Los 4 mapas de
  labels se unificaron en un solo `RT_LABEL`.
- ❌ **No era divergencia** (rt=2 y el gate): se creía que el real conservaba un rt=2 con `have_ctopx`
  al fallar el gate. Verificado leyendo el código: el real lo **excluye igual** — `legacy-backend
  LenderValidationService:382` hace `unset` de todo rt=2, la guarda `have_ctopx` de :320/:328 es
  redundante. El simulador ya era fiel.
- ⏳ **Un motor de datacrédito donde el real tiene dos** (campos y comparadores distintos) — *sigue
  pendiente*: es la única divergencia de fidelidad viva. Ver Grupo C.

---

## 5. Los próximos nodos (propuesta)

Agrupados por lo que completan. ⭐ = mayor valor inmediato, porque explica un dolor frecuente de
soporte.

### Grupo A — Cerrar el círculo: del listado al crédito vivo

| Nodo | Qué muestra | Qué pregunta responde |
|---|---|---|
| ✅ **Formalización (firma · KYC · enganche)** — *hecho* | Ciclo de vida post-selección por rt: plan → KYC (ADO) → firma del pagaré (OTP) → cobro del enganche (Wompi). Stepper con fallo por paso | "¿Qué falta para que quede aprobado?" · "¿Por qué rebota el link con enganche?" (FAQ E2) |
| ✅ **Estado del crédito / Estado 11 + aviso** — *hecho* | El cierre: Estado 11 "Autorizada" + aviso (webhook) a la tienda; o detenido/rechazado/timeout según dónde se cortó | "El lender ya desembolsó y el estado no cambia" (FAQ D1) |
| ⭐ **Punto de venta — la 2ª evaluación** — *pendiente* | Al "confirmar", corre la evaluación autoritativa (crédito activo, reglas, categoría, cupo) y **compara contra lo que el listado había mostrado** | "¿Por qué el preaprobado no aparece / sale sin cupo en el POS?" (FAQ A1 — el dolor nº 1) |
| *Vida del crédito (cartera)* — *fuera de alcance* | Servicing post-Estado 11 (al día → mora → paz y salvo; cascada de un pago). Otro grafo | "¿Por qué sigue en mora si pagó?" (FAQ F1) |

### Grupo B — La entrada real: antes de la solicitud

| Nodo | Qué muestra | Qué pregunta responde |
|---|---|---|
| **Canal de entrada** | Por dónde llega el cliente: asesor (QR de autogestión), ecommerce (WooCommerce/VTEX), Alkosto/lotes — y de dónde sale el **monto** en cada caso | "¿Por qué el monto o el flujo cambian según el canal?" |
| ⭐ **Registro + OTP (nace la solicitud)** | Celular → código → recién ahí **nace** la solicitud; si había una previa a medio camino, **se recicla** | "No llega el OTP" (E1) · "el usuario ya existe" (G1) |

### Grupo C — Completar la decisión

| Nodo / cambio | Qué muestra | Qué pregunta responde |
|---|---|---|
| **Los dos motores de datacrédito** *(mejora del nodo actual)* | El motor viejo (externas) y el nuevo (CreditopX) lado a lado, con campos y comparadores distintos — el mismo cliente puede pasar uno y fallar el otro | "¿Por qué pasa en una entidad y falla en otra con el mismo buró?" |
| **Cupo rotativo** | Entidad con cupo reutilizable: la primera compra firma pagaré maestro; las siguientes consumen y liberan cupo | "¿Cómo funciona el rotativo?" |
| **Credifamilia (asíncrona)** | Originamos acá, radicamos allá: la espera asíncrona (el aprobado/rechazado llega después) | "¿Por qué queda 'en proceso'?" |
| **Modo del comercio** | El selector real de modo (compra / renting / alquiler) por solicitud, con el paso extra de Ábaco cuando aplica | "¿Qué cambia el modo? (spoiler: no las entidades)" |

### Grupo D — El detrás de escena del admin

| Nodo | Qué muestra | Qué pregunta responde |
|---|---|---|
| ⭐ **Habilitar entidad = copiar reglas** | El evento real: al prender una entidad en la sucursal se **copian** las reglas en ese momento; si después cambia la plantilla, la copia no se entera (deriva); si la copia falla, la sucursal queda **sin reglas** | "Al comercio no le aparecen entidades" (FAQ H1) |
| **Credencial comercio↔entidad** | El contrato/llaves reales: sin credencial, la entidad puede **verse** pero no **funcionar** | "Se ve pero no deja avanzar" |

### Ruta para subir la cobertura de la originación (hoy ~35%)

Cada fase suma nodos y sube el %. Entre paréntesis, el objetivo acumulado aproximado.

1. **Fase 1 — cerrar la historia del POS (→ ~50%).** **2ª evaluación** (re-chequeo al confirmar vs
   el snapshot del listado; dolor nº 1) + **Registro/OTP** (nace/recicla la solicitud). Con esto el
   grafo cuenta la solicitud completa: entra → decide → *re-decide en el POS* → formaliza → cierra.
2. **Fase 2 — contexto y fidelidad (→ ~65%).** **Canal de entrada** (asesor/ecommerce/Alkosto + de
   dónde sale el monto), **modo del comercio** (+ paso Ábaco), **admin** (habilitar entidad = copiar
   reglas + credencial), y los **ajustes de fidelidad** de §4 (sobre todo los **2 motores de
   datacrédito** y el **orden real del listado**).
3. **Fase 3 — los productos que faltan (→ ~75-80%).** **SmartPay**, **cupo rotativo** y
   **Credifamilia** asíncrona (ver §6).

### El techo honesto: por qué 100% es un espejismo (~85% es "completo")

Un simulador de documentación tiene un tope natural **~85%** sobre la originación. El último tramo
no se puede (o no conviene) simular:

- **Las decisiones de los agregadores (rt=1) son externas.** No las controlamos ni en producción:
  el simulador las representa con un switch aprueba/rechaza/timeout — *ficción honesta*, no
  fidelidad. Ese ~15% no es "simulable" por definición.
- **Integraciones reales** (biometría ADO, OTP, checkout Wompi, firma Netco/Deceval): el grafo
  modela **la secuencia y el desenlace**, no la mecánica interna de cada proveedor. Profundizar eso
  da poco valor pedagógico por mucho costo.
- **Servicing** (cuotas/mora/cartera) queda **fuera** por decisión (otro grafo).

O sea: apuntar a **80-85%** de la originación es "el grafo cuenta toda la historia con fidelidad
donde la controlamos". Pasar de ahí es rendimiento decreciente.

---

## 6. Qué tienen de distinto SmartPay y Credifamilia

Ambos son **variantes** del flujo, no productos aparte — por eso mueven la aguja de "Productos" y
"Tipos de entidad". La diferencia está en la **garantía** (SmartPay) y en **cómo y quién formaliza**
(Credifamilia).

### SmartPay — el celular ES la garantía

- **Sigue siendo CreditopX (rt=2), in-platform**: usa la misma columna vertebral (decisión local,
  formalización local). No cambia *quién decide*.
- **Lo distinto: la garantía es el equipo.** El flujo entra por el **IMEI** del celular; el teléfono
  financiado queda como colateral.
- **Bloqueo remoto (MDM).** Si el cliente no paga, el dispositivo se **bloquea** de forma remota
  (device-lock). En el sistema real lo gestionan **crons del servicing** (post-desembolso) — o sea,
  la parte más jugosa de SmartPay vive en la zona que hoy está **fuera de alcance** (cartera).
- **En el simulador**: hoy es solo el `producto`. Modelarlo bien = un paso extra en la
  formalización ("acuerdo de bloqueo del equipo") + el candado en la vida del crédito (servicing).
- Identificador técnico: EAV del canal SmartPay (dev 153 / prod 160).

### Credifamilia — originamos acá, formaliza allá (asíncrono)

- **Otro response_type (rt=4).** Ahí está la ambigüedad de riesgo del código: la **radicación SOAP
  de formalización solo corre en rt==4**; si se trata como rt=2 se salta ese cierre.
- **KYC distinto.** No usa ADO: usa **Evidente + CrossCore + Jumio** (stack V2, greenfield en
  legacy-backend). Es un pipeline de identidad propio.
- **Formalización ASÍNCRONA.** CreditOp origina y **radica** contra Credifamilia por SOAP; el
  **aprobado/rechazado llega después** (no en la misma sesión). De ahí el "queda en proceso".
- **La carrera de timeouts** que ya trazamos: front espera ~40s, el MS escribe con timeout ~30s →
  puede divergir lo que ve el usuario de lo que persiste.
- **En el simulador**: hoy la cadena rt=1 (radica → decisión externa → timeout) ya **insinúa** el
  caso asíncrono con el toggle "timeout / en proceso". Modelar Credifamilia fino = una rama rt=4 con
  su KYC propio + el desenlace diferido.

**Resumen de una línea:** SmartPay cambia **la garantía** (celular + bloqueo, casi todo en
servicing); Credifamilia cambia **quién formaliza y cuándo** (externo, asíncrono, rt=4, KYC propio).

---

*Balance basado en la auditoría de cobertura del 2026-07-11 (13 dimensiones), actualizado tras
construir la formalización post-selección. Alcance = originación (servicing aparte). Los porcentajes
son estimaciones calibradas, no mediciones exactas: sirven para priorizar, no para rendir cuentas.*
