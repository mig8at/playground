# FAQ-SOPORTE.md — Guía de diagnóstico para soporte CreditOp

> **Qué es.** Respuestas a los dolores más frecuentes reportados en **#tech-ops**, cruzados con el
> mapa verificado del flujo ([MAP.md](MAP.md)). Para cada pregunta: **causa más probable**, **qué
> revisar / dónde escalar**, y una marca de **confianza**.
>
> **Confianza:** 🟢 lo entendemos y explicamos con el mapa del flujo · 🟡 sabemos dónde vive, falta
> confirmar el caso puntual · 🔴 depende de un tercero externo (fuera de CreditOp).
>
> **Base:** barrido de ~590 mensajes de #tech-ops (jun–jul 2026) + MAP.md. No incluye datos de clientes.
> Las causas son la explicación **más probable** según el flujo; un caso individual puede diferir.

---

## Cómo usar esta guía
1. Ubicá el síntoma por **etapa** (A→I abajo).
2. Leé la **causa probable** y **qué revisar** antes de escalar.
3. Si el caso encaja, respondé con la explicación corta; si no, escalá al equipo indicado con los datos que pide "qué revisar".

Etapas del flujo (recordatorio): `registro/OTP → formulario → burós → listado/pre-aprobación → selección → punto de venta → desembolso → cartera`.

---

## A · Listado y pre-aprobación *(lo más frecuente)*

### A1. "El cliente ve un preaprobado (o 'probabilidad alta') que en el punto de venta NO aparece / sale sin cupo / rechazado" 🟢
**Causa probable.** El preaprobado que ve en la app/correo **no es la decisión final**. En el punto de venta se vuelve a correr la evaluación completa y autoritativa, que la app no re-evalúa. Los tres motivos típicos:
- **Ya tiene un crédito CreditopX activo** → se excluye el cupo (no se puede tener dos a la vez).
- **CreditopX (rt=2, ej. Dentix):** en el punto de venta corre la 2ª capa (reglas de sucursal + datacrédito) y la **categoría/cupo real**, que puede topear el cupo a 0.
- **Agregador (rt=1, ej. Welli/Bancolombia/Prami):** la **API del banco decide en vivo**; el preaprobado previo pudo cambiar. *"No pudimos consultar esta entidad"* = la consulta a esa entidad tuvo timeout/error en ese momento.

**Qué revisar.** ¿El cliente tiene un crédito CreditopX vigente? ¿El monto pedido en el POS supera el cupo de su categoría? ¿La entidad es rt=1 (decide su API)? Si dice "no pudimos consultar", reintentar (suele ser un timeout puntual).
**Ref:** MAP.md §S5 (cupo rt=2) · §S6 (rt=1 API externa).

### A2. "Salió aprobado pero de ÚLTIMO" (ej. Credifamilia) 🟢
**Causa probable.** El orden del listado clasifica por probabilidad. Una entidad **rt≠2 que no cumple todas las reglas de la sucursal NO se excluye: se manda al fondo** como "probabilidad muy baja". Además hay un ordenamiento por modelo/matrices. Que aparezca abajo no es un error: es la clasificación.
**Qué revisar.** ¿La entidad cumple las group_rules de esa sucursal? Si no, "abajo" es el comportamiento esperado.
**Ref:** MAP.md §S5 (group_rules rt≠2 → fondo · orden por probabilidad).

---

## B · Datacrédito / buró

### B1. "No le disparó / no consultó datacrédito" 🟢
**Causa probable.** La consulta a datacrédito está **gateada**: (a) el **disparador de la sucursal** (edad/género/ingreso/ocupación) — si el cliente no lo cumple, no se consulta; y (b) la **frecuencia** por aliado — si ya se consultó hace poco, no se vuelve a quemar. También hay guarda por país.
**Qué revisar.** ¿El cliente cumple el disparador de esa sucursal? ¿Se consultó recientemente (frecuencia)? ¿El comercio es de Colombia?
**Ref:** MAP.md §S4 (userViability + frecuencia).

---

## C · Cuota y montos

### C1. "La cuota SUBE al llegar al plan de pagos final" / "se cobra de más por el fondo de garantías" 🟢
**Causa probable.** El **fondo de garantías (FGA)** se suma al capital financiado y **lleva IVA del 19% encima**. Si una pantalla temprana (simulador) no lo incluye y el plan final sí, la cuota "salta". No es doble cobro: es el FGA + IVA que entra en la cuota final.
**Qué revisar.** ¿La entidad tiene fondo de garantías configurado (> 0%) en el comercio? El salto ≈ FGA·1,19 prorrateado en las cuotas.
**Ref:** MAP.md §S5 (cuota = financiado + admin + FGA·1,19 → anualidad + seguros).

### C2. "El crédito se originó por un monto distinto a la venta del comercio" 🟡
**Causa probable.** El monto puede ajustarse por piso mínimo del tramo, redondeo/múltiplo, o por el cupo tope de la categoría. Sabemos dónde se decide (tramo por monto + categoría) pero el desajuste puntual hay que verlo caso a caso.
**Qué revisar.** Comparar monto solicitado vs cupo de la categoría vs mínimo del tramo. Escalar a producto/back con el nº de solicitud.
**Ref:** MAP.md §S5 (tramo por monto + cupo).

---

## D · Estado y desembolso

### D1. "El lender (Prami/Meddipay) ya confirmó el desembolso pero el estado no cambia / no genera voucher / no aparece 'gestionar'" 🟢
**Causa probable.** La sincronización del estado depende del **webhook del lender** (`lender-result`). Ese aviso es *best-effort*: si falla, o (en el refactor) todavía no está cableado para ese agregador, CreditOp se queda "abierto" aunque el lender ya desembolsó.
**Qué revisar.** ¿Llegó el webhook del lender? Escalar a back para reprocesar el resultado del lender.
**Ref:** MAP.md §S6 (webhook lender-result, best-effort) · migración (webhooks agregadores pendientes).

---

## E · Onboarding / OTP / link

### E1. "El OTP es correcto y no lo deja pasar" / "no llega el OTP" 🟡
**Causa probable.** El OTP lo maneja el back (envío por Twilio; validación crea la solicitud). *"No llega"* = entrega (Twilio) → infra. *"Correcto y rebota"* = probable timeout del wizard o pérdida de sesión.
**Qué revisar.** ¿Aparece el SMS en Twilio? Si no, es entrega. Si llega pero rebota, reintentar/limpiar sesión; si persiste, escalar con nº de celular y hora.
**Ref:** MAP.md §S3 (registro/OTP en legacy).

### E2. "El link para continuar no llega o no carga; el proceso se queda pegado" 🟡
**Causa probable.** Dos frentes: **entrega** del link (Twilio/correo/WhatsApp) → infra; o el **link de continuación** que rebota (caso conocido en CreditopX rt=2 con cuota inicial > 0). "No carga" en otro dispositivo/incógnito suele ser el link, no el navegador.
**Qué revisar.** ¿El link se generó y se envió (Twilio)? ¿La entidad es CreditopX con cuota inicial? Escalar con el nº de solicitud.
**Ref:** MAP.md §S3 · nota de rebote de continuación.

---

## F · Cartera / mora *(post-desembolso)*

### F1. "El cliente aparece en mora pero la fecha de pago es ANTERIOR a la originación" / "pagó adelantado y sigue en mora" 🟡
**Causa probable.** La cartera post-desembolso corre en `application` con **crons diarios** que arman el calendario de pagos y la mora. Una fecha de pago previa a la originación es un **bug de datos** en ese calendario (o de la migración). Sabemos el módulo; el bug puntual requiere revisión de back.
**Qué revisar.** Escalar a back/cartera como **urgente** con el nº de crédito; no se resuelve desde soporte.
**Ref:** memoria de servicing/cartera (crons diarios, ledger CreditopX).

---

## G · Registro / usuario

### G1. "El correo/número aparece 'ya creado' aunque el cliente no pasó el formulario" 🟡
**Causa probable.** La solicitud se **recicla**: si el cliente ya tiene una solicitud previa en estados iniciales, el sistema la reutiliza, y el usuario se crea **temprano** (en el registro por celular). Por eso puede "existir" sin haber terminado. El caso "lo elimino y reaparece" necesita revisar el de-duplicado.
**Qué revisar.** ¿Hay una solicitud previa del mismo documento? Escalar con documento si "reaparece" tras borrarlo.
**Ref:** MAP.md §S3 (reciclaje de solicitud, creación temprana de usuario).

---

## H · Configuración / admin

### H1. "A este comercio no le aparecen entidades / le sale 'sin opciones disponibles'" 🟢
**Causa probable.** Las reglas y la visibilidad de entidades se **copian por sucursal** al habilitar la entidad. Si esa copia falla (el sistema se traga el error y solo manda un correo), la sucursal queda **habilitada sin reglas o sin entidades**.
**Qué revisar.** ¿La sucursal tiene entidades habilitadas y reglas copiadas? Escalar a quien parametriza el admin para re-habilitar (re-dispara la copia).
**Ref:** MAP.md §S1/§S2 (copia de reglas por sucursal).

### H2. "Toggle de configuración mal (ej. 'lo gestiona el usuario', cupo rotativo, entidad duplicada, logo)" 🟢
**Causa probable.** Config del admin por comercio/sucursal (no es bug de flujo). Ej.: *"lo gestiona el usuario"* (auto-gestión) debe estar prendido para el flujo esperado.
**Qué revisar.** Revisar la config del comercio/entidad en el admin.
**Ref:** MAP.md §S1/§S2 · anatomía del admin.

---

## I · Agregador externo

### I1. "Bancolombia aprobó, activó el producto y luego lo canceló + debitó de la cuenta" 🔴
**Causa.** rt=1: **Bancolombia decide y ejecuta todo de su lado**; CreditOp solo muestra y espeja el resultado. La activación/cancelación/débito ocurrió en Bancolombia.
**Qué hacer.** **Escalar a Bancolombia** con el caso. CreditOp no lo controla ni puede revertir el débito.
**Ref:** MAP.md §S6 (frontera rt=1: la API externa decide).

---

## Patrón de fondo
La mayoría de los dolores TOP nacen de **"lo que se muestra ≠ lo que decide el punto de venta"** (preaprobado / cupo / cuota) y de la **migración (refactor)** (webhooks y sincronización de estado). El [simulador de onboarding](.) reproduce este flujo para explicar exactamente dónde y por qué difieren.

## Qué todavía NO respondemos con certeza (🟡/🔴)
- Bug puntual de **mora con fecha previa a la originación** (F1) — requiere revisar el cron de cartera.
- **OTP correcto que rebota** (E1) — requiere reproducir el timeout/sesión.
- **Usuario que reaparece tras borrarlo** (G1) — requiere revisar el de-duplicado.
- Casos de **agregador externo** (I1) — dependen del tercero.

---

*Fuente: #tech-ops (jun–jul 2026) + MAP.md. Actualizar cuando cambien los flujos del refactor.*
