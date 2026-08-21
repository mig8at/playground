# CreditOp — Mapa de rutas de contexto

> Índice estático del árbol de contexto (reemplaza al MCP). **Cómo usar:** leé los `Cuándo:` de abajo, elegí 2–4 nodos que matcheen tu tarea, abrí `server/data/flows/<id>/doc.md` (el análisis) y `server/data/flows/<id>/map.json` (la lista de archivos fuente), y de ahí leé el código real. Las rutas de `map.json` son `alias/relpath`.

**Repos (alias → root):** `application`→`~/Desktop/CREDITOP/github/legacy-application` · `frontend-monorepo`→`~/Desktop/CREDITOP/github/frontend-monorepo` · `legacy-backend`→`~/Desktop/CREDITOP/github/legacy-backend` · `pre-approvals-service`→`~/Desktop/CREDITOP/github/pre-approvals-service` · `form-service`→`~/Desktop/CREDITOP/github/form-service` · `customer-profiling-service`→`~/Desktop/CREDITOP/github/customer-profiling-service` · `onboarding-forms-service`→`~/Desktop/CREDITOP/github/onboarding-forms-service` · `customer-service`→`~/Desktop/CREDITOP/github/microservices/customer-service` · `financial-health-service`→`~/Desktop/CREDITOP/github/microservices/financial-health-service` · `pdf-mapper-service`→`~/Desktop/CREDITOP/github/microservices/pdf-mapper-service` · `harness`→`~/Desktop/CREDITOP/playground/harness` · `trazador`→`~/Desktop/CREDITOP/playground/trazador`

**Mantenimiento:** validar que las rutas resuelven → `python3 tools/oracle.py <map.json>`. Regenerar este mapa → `python3 tools/build-route-map.py`.

## Entrá por el síntoma

Si la tarea llega con una de estas frases, empezá por esos nodos. Si ninguna matchea, leé los `Cuándo:`.

| Lo que te dicen | Empezá por |
|---|---|
| «a este comercio le pasa distinto» | `merchants` |
| «a este usuario le salen datos de OTRO comercio» | `actors` · `application` |
| «¿a quién le pregunto esto?» | `negocio` |
| «ayer se saltaba la validación de identidad y hoy se la vuelve a pedir» | `kyc` |
| «cambió el perfilamiento y no hubo deploy» | `db-routines` |
| «cambió el resultado y no hubo deploy ni cambió el dato» | `db-routines` |
| «¿de dónde sale el ingreso / la ocupación del cliente?» | `db-routines` |
| «¿de dónde sale el reporte de liquidación?» | `negocio` |
| «¿de qué vive CreditOp?» | `negocio` |
| «desde operaciones no puedo ver/validar al usuario» | `backoffice` |
| «dice que los datos no coinciden» / falla la identidad | `kyc` |
| «¿dónde se cae la gente en el embudo?» | `negocio` |
| «¿dónde se trabó?» | `aggregator` · `formalization` · `trazador` |
| «el botón Descargar Solicitudes trae mal» | `application` |
| «el celular no se bloquea» / IMEI | `smartpay` |
| «el cliente no puede firmar el pagaré» | `deceval` |
| «el codeudor no recibió el link» | `codeudor` |
| «el codeudor ve la pantalla del comprador» | `codeudor` |
| «el código de compra en caja no sirve» | `corbeta` |
| «el documento salió sin la firma del codeudor» | `codeudor` |
| «el endpoint devuelve un código raro» (ONB0xx) | `legacy-backend` |
| «el listado tardó minutos» | `profiling` |
| «el monolito no tiene este endpoint» | `microservicios` |
| «el número no cuadra y no encuentro dónde se calcula» | `db-routines` |
| «el pagaré dice una persona y la BD dice otra» | `formalization` |
| «el pago no se ve reflejado en el saldo» | `servicing` |
| «el reporte que descargó trae de más» | `application` |
| «el rotativo le dio cupo 0 y no sé por qué» | `rotativo` |
| «el webhook del lender no llegó» | `aggregator` |
| «eligió la entidad y no pasó nada» | `aggregator` |
| «en este comercio se salta pasos» | `merchants` |
| «¿en qué repo vive esto?» | `microservicios` |
| «¿en qué repo vive esto?» / «está duplicado» | `architecture` |
| «entró desde la tienda online y se rompió» | `ecommerce` |
| «esto anda en local y no en dev/qa» | `findings` · `trazador` |
| «esto no puede ser, la entidad funciona en otro comercio» | `creditop` |
| «¿esto no se puede parametrizar?» | `negocio` |
| «¿esto ya está en el backoffice nuevo?» | `application` |
| «falló con Bancolombia» | `bancolombia` |
| «falló con Credifamilia» | `credifamilia` |
| «falló el renting / Ábaco» | `motai` |
| «falló en Pullman / CrediPullman» | `pullman` |
| «falló firmando documentos» | `findings` · `formalization` |
| «firmó y la solicitud no pasó a Autorizada» | `codeudor` |
| «firmó y no se desembolsó» | `deceval` |
| «formulario no encontrado» | `dynamic-forms` · `form-service` |
| «¿hay dónde ver qué regla falló y con qué valor?» | `backoffice` |
| «hay que agregar un campo al formulario» | `dynamic-forms` · `form-service` |
| «hay que integrar una entidad nueva» | `hardcodes-entidades` |
| «hay que rehacer el panel de configuración» | `merchants` |
| «la comisión del reporte salió en cero» | `negocio` |
| «la cuota del plan de pagos no coincide con el contrato» | `motai` |
| «la fecha de esa tabla no coincide con nada» | `db-routines` |
| «la pantalla del wizard se ve/comporta mal» | `frontend-monorepo` |
| «las condiciones que vio no son las del cupo que quedó» | `rotativo` |
| «lo mandó al sitio del lender y no volvió» | `redirect` |
| «los datos del cliente no coinciden con el registro» | `deceval` |
| «necesito decirle al comercio POR QUÉ no le salió esa entidad» | `backoffice` |
| «necesito reproducir/probar un flujo entero» | `findings` · `harness` |
| «no aparece el tipo de documento PEP» | `motai` |
| «no le apareció ninguna entidad» | `creditopx` · `findings` · `kyc` · `merchants` · `profiling` |
| «no le consultaron el buró» | `kyc` |
| «no le llega el OTP del registro» | `onboarding` |
| «no le llegó el OTP de la firma» | `formalization` |
| «no puede pasar del formulario» | `onboarding` |
| «no sé por dónde empezar» | `creditop` |
| «no tiene permisos» / «ve un panel mutilado» | `actors` |
| «pagó y no se refleja» / cuota inicial | `payments` |
| «pide codeudor y no debería» / «no lo pide y debería» | `codeudor` |
| «pidió X y le ofrecieron menos plazo» | `amount-tiers` |
| «¿por qué a este cliente no le salió esta entidad?» | `trazador` |
| «¿por qué el listado salió en ese orden?» | `profiling` |
| «¿por qué esta cuota inicial / este FGA?» | `rotativo` |
| «¿por qué está hecho así?» | `negocio` |
| «¿por qué le salió ESE cupo / esa categoría?» | `profiling` |
| «¿por qué no le sale esta entidad?» | `creditopx` · `hardcodes-entidades` · `merchants` · `ms-preapprovals` |
| «¿por qué tarda una semana montar un comercio?» | `negocio` |
| «quedó aprobada y no se desembolsó» | `formalization` |
| «¿quién pone la plata en este crédito?» | `negocio` |
| «¿qué cubre el fondo de garantía?» | `negocio` |
| «¿qué es el FGA / el fondo de garantía?» | `negocio` |
| «¿qué es este service_name de los logs?» | `microservicios` |
| «¿qué falta para apagar application?» | `application` |
| «¿qué gana CreditOp con los bancos?» | `negocio` |
| «¿qué integra de verdad esta entidad?» | `entities` |
| «¿qué le pasó a ESTA solicitud?» | `trazador` |
| «reversé un pago y tiró error» | `servicing` |
| «sale pre-aprobado y no debería» (o al revés) | `ms-preapprovals` |
| «se guardó el nombre mal / con un solo apellido» y nada avisó | `kyc` |
| «se le cambió sola la config de una entidad» | `merchants` |
| «se va un comercio, ¿qué hago con sus créditos vivos?» | `negocio` |
| «ya está desembolsado y la cuota está mal» | `servicing` |
| «ya nos pasó esto antes?» | `findings` |

## Árbol
```
- creditop
  - actors [ref]
  - architecture [ref]
    - application [ref]
    - frontend-monorepo [ref]
    - harness [ref]
    - legacy-backend [ref]
    - microservicios [ref]
    - ms-preapprovals [ref]
    - trazador [ref]
  - backoffice [ref]
  - codeudor [ref]
  - db-routines [ref]
  - ecommerce [ref]
  - entities [ref]
    - aggregator [ref]
      - bancolombia [ref]
    - credifamilia [ref]
    - creditopx [ref]
      - amount-tiers [ref]
      - profiling [ref]
      - rotativo
    - redirect [ref]
  - findings [ref]
  - formalization [ref]
    - deceval
    - dynamic-forms [ref]
      - form-service [ref]
  - hardcodes-entidades [ref]
  - merchants [ref]
    - corbeta [ref]
    - motai [ref]
    - pullman [ref]
    - smartpay [ref]
  - negocio [ref]
  - onboarding [ref]
    - kyc [ref]
  - payments [ref]
  - servicing [ref]
```

## Nodos

### creditop — CreditOp  ·  _root_ · 59 archivos
**Cuándo:** Cuando la tarea toca material TRANSVERSAL que ningún contexto dueña: tablas y datos clave, máquinas de estado y el `Estado 11`, frontera de pruebas y harness, deuda técnica y hardcodes, glosario y colisiones de id (`24` = lender Credifamilia Y allied Creditop). También cuando no sabés por dónde empezar. ⚠ Y **siempre antes de concluir algo**: trae los 7 INVARIANTES que corrigen las conclusiones obvias-y-falsas — la conducta la decide el PAR (comercio, entidad) y no la entidad (F-34), la config se COPIA y no se hereda, un estado dice DÓNDE está y no QUÉ completó (F-103/105/106), la ausencia de un log no prueba nada (F-94/102).
Doc: `server/data/flows/creditop/doc.md` · Archivos: `server/data/flows/creditop/map.json`

### actors — Actors  ·  _reference_ · 68 archivos
**Cuándo:** Cuando la pregunta es de PERMISOS o de quién hace qué: cliente vs asesor vs back-office, login, Cognito y SSO, roles y alcance, y por dónde entra cada uno (QR, link de continuación, autogestión).
Doc: `server/data/flows/actors/doc.md` · Archivos: `server/data/flows/actors/map.json` · Padre: `creditop`

### aggregator — Aggregator  ·  _reference_ · 106 archivos
**Cuándo:** Cuando el prestamista decide AFUERA por API (`response_type` 1): Bancolombia (BNPL 68 / Consumo 100), Sistecrédito, Welli, Addi, Meddipay (39), Banco de Bogotá. Pre-aprobación, webhook `lender-result`, cartera del tercero, y por qué no se puede simular en local. ⚠ El webhook NO registra su recepción: «no llegó» y «llegó y falló» se ven igual desde la BD (F-94), y la única huella es `profiling_reviews.disbursed_lender`.
Doc: `server/data/flows/aggregator/doc.md` · Archivos: `server/data/flows/aggregator/map.json` · Padre: `entities`

### amount-tiers — Amount tiers  ·  _reference_ · 33 archivos
**Cuándo:** Cuando el plazo se recorta o el cupo se topea según el MONTO pedido: los tramos por monto de rt=2, en `creditop_x_conditions_by_amount_by_lender` (con `amount_conditions`, `below_min_amount`). Síntoma típico: «pidió X y le ofrecieron menos plazo del que esperaba». Ojo: los tramos NO tocan el enganche — eso es de la categoría, y va en `profiling`.
Doc: `server/data/flows/amount-tiers/doc.md` · Archivos: `server/data/flows/amount-tiers/map.json` · Padre: `creditopx`

### application — application  ·  _reference_ · 92 archivos
**Cuándo:** Cuando trabajás en el monolito Aliados (el que corre en prod): panel de administración, alta de entidades/comercios/sucursales, crons de cobranza y servicing, Inertia/Vue, rutas por audiencia admin/customer/api. También cuando el reporte que descarga un comercio trae datos de MÁS comercios, o cualquier cosa del botón «Descargar Solicitudes» / reporte de solicitudes originadas: los exports viven acá y su alcance depende del ROL (ver el nodo `actors`).
Doc: `server/data/flows/application/doc.md` · Archivos: `server/data/flows/application/map.json` · Padre: `architecture`

### architecture — Architecture  ·  _reference_ · 77 archivos
**Cuándo:** Cuando la duda es en QUÉ REPO vive algo, por qué está duplicado, o cómo se hablan entre sí: base de datos compartida, migraciones duplicadas, cutover al wizard nuevo, allowlist, SSO, VITE_API_URL. Índice de los repos.
Doc: `server/data/flows/architecture/doc.md` · Archivos: `server/data/flows/architecture/map.json` · Padre: `creditop`

### backoffice — Backoffice  ·  _reference_ · 119 archivos
**Cuándo:** Cuando la tarea toca el PANEL NUEVO de back-office (React/Refine, /api/backoffice) o el login de staff por Cognito: buscar un usuario o una solicitud desde operaciones, ver su perfilamiento/Experian/OTPs, validar identidad a mano, o el módulo Auth y sus dos pools (staff | comercios). NO es el admin viejo de Inertia — ese vive en `actors`/`application`.
Doc: `server/data/flows/backoffice/doc.md` · Archivos: `server/data/flows/backoffice/map.json` · Padre: `creditop`

### bancolombia — Bancolombia  ·  _reference_ · 145 archivos
**Cuándo:** Cuando la tarea toca Bancolombia (BNPL lender 68 / Consumo lender 100): su onboarding propio en el wizard, la secuencia multi-step de originación (login→cuota→cuenta→términos→clave dinámica→origination; consumo: validate→ofertas→simulación→seguro→e-sign), el código de compra en punto de venta (PIN de Corbeta / In Store Billing Code), los escenarios sandbox por cédula y por celular, JWT RS256 + mTLS, o el webhook de estado que sigue en application. Es el único rt=1 con originación completa DENTRO de CreditOp.
Doc: `server/data/flows/bancolombia/doc.md` · Archivos: `server/data/flows/bancolombia/map.json` · Padre: `aggregator`

### codeudor — Codeudor  ·  _reference_ · 69 archivos
**Cuándo:** Cuando en la tarea aparece un SEGUNDO firmante: codeudor, cosigner, deudor solidario, «necesita codeudor», «el codeudor no puede firmar», la invitación por WhatsApp o su deep link, el estado «Solicita codeudor», la pantalla de espera del titular mientras el codeudor valida, la firma cruzada (titular y codeudor firmando el MISMO documento), o el catálogo de documentos que cambia según haya codeudor o no (`lender_signing_documents`). También cuando una solicitud queda aprobada por OTP y NO llega al estado 11: puede estar diferida esperando la firma del codeudor.
Doc: `server/data/flows/codeudor/doc.md` · Archivos: `server/data/flows/codeudor/map.json` · Padre: `creditop`

### corbeta — Corbeta  ·  _reference_ · 28 archivos
**Cuándo:** Cuando la tarea es del GRUPO DE COMERCIOS Corbeta (retail físico: Alkosto 209 / K-TRONIX 210 / Alkomprar 211; el allied 24 del gate es 'Creditop', la cuenta propia de la casa) y la venta se cierra en CAJA: checkout ecommerce base64 → PIN de la API Fondos → factura en tienda → conciliación batch por PIN → estado 26 Facturado → confirmación diferida al lender. Sus tres retail tienen SÓLO Bancolombia habilitado (68 BNPL / 100 Consumo): la decisión de crédito y los endpoints de originación son del nodo `bancolombia`.
Doc: `server/data/flows/corbeta/doc.md` · Archivos: `server/data/flows/corbeta/map.json` · Padre: `merchants`

### credifamilia — Credifamilia  ·  _reference_ · 142 archivos
**Cuándo:** Cuando la tarea toca Credifamilia (lender 24, el único response_type=4): radicación por SOAP, KYC V2 (Evidente/CrossCore/Jumio), plan de cuotas dinámico, o el gate local que hace que no aparezca en pruebas.
Doc: `server/data/flows/credifamilia/doc.md` · Archivos: `server/data/flows/credifamilia/map.json` · Padre: `entities`

### creditopx — CreditopX  ·  _reference_ · 19 archivos
**Cuándo:** Cuando la pregunta es por qué una entidad aparece o NO aparece en el listado, y con qué enganche, cupo y plazo. La cascada in-platform rt=2/3: reglas de grupo (`group_rules`), datacrédito, categoría y cupo disponible. La calculadora vive en `lenders_by_allieds` y la visibilidad por sucursal en `lenders_by_allied_branches`. ⚠ La conducta la decide el PAR (comercio, entidad), no la entidad — ver F-34 antes de concluir «esta entidad está rota».
Doc: `server/data/flows/creditopx/doc.md` · Archivos: `server/data/flows/creditopx/map.json` · Padre: `entities`

### db-routines — Rutinas de BD  ·  _reference_ · 7 archivos
**Cuándo:** Cuando el cálculo que buscás NO aparece en el código PHP: hay 42 procedimientos y funciones almacenados en MySQL con lógica de negocio, invocados como string dentro de `DB::scalar` / `DB::select` / `CALL`, así que grepear el nombre del campo nunca llega a la fórmula. Acá viven el ingreso promedio y la ocupación que deciden la categoría (`FN_User_Income_Average`, `FN_User_Occupation`), las 23 `FN_Experian_*` que arman los features del perfilador ML (`SP_Experian_Extract_Data`), el parseo de Mareigua y AgilData, el revolvente rt=3, el descifrado del reporte (`FN_Decrypt_Data`) y el SP que ata el buró a la solicitud (F-107). ⚠ 4 de las 42 NO tienen fuente en ningún repositorio y dos de ellas se llaman desde producción. ⚠ Y no son sólo rutinas: hay un EVENT nocturno que reconstruye entera `user_request_risk_central_user_data` (sin fuente en ningún repo), 28 vistas que calculan, y CERO triggers (medido).
Doc: `server/data/flows/db-routines/doc.md` · Archivos: `server/data/flows/db-routines/map.json` · Padre: `creditop`

### deceval — Deceval (pagaré digital)  ·  _flujo_ · 20 archivos
**Cuándo:** Cuando el problema es la FIRMA DEL PAGARÉ contra Deceval —el depósito de la BVC que custodia los títulos valores digitales—: «el cliente no puede firmar», «los datos no coinciden con el registro», «el pagaré quedó sin número», «se firmó pero no se desembolsó». Acá viven el ruteo por método de firma (`lenders.promissory_type_id` → `deceval` | `ownership`), las cuatro operaciones SOAP (createGirador → createPagare → consultPagare → signPagare), WS-Security con mTLS, las credenciales POR DEPOSITANTE (cada lender tiene su propio código ante Deceval, y cada depositante exige campos distintos del girador), y las dos tablas que reconstruyen un caso: `deceval_logs` (el XML enviado y recibido) y `promissory_notes`. Hoy en producción con Credifamilia y Dentix. NO es el OTP en sí (eso es `formalization`) ni el pagaré tradicional sin Deceval.
Doc: `server/data/flows/deceval/doc.md` · Archivos: `server/data/flows/deceval/map.json` · Padre: `formalization`

### dynamic-forms — Dynamic Forms  ·  _reference_ · 84 archivos
**Cuándo:** Cuando hay que agregar o cambiar un CAMPO del formulario por configuración: las tres generaciones de formulario dinámico, EAV `user_field_values`, tipos de documento por sucursal, `form_type` por lender (Credifamilia es el 6). Síntomas típicos: «formulario no encontrado», el form dinámico carga pero no deja avanzar, o hay que sumar un campo en cascada (departamento→ciudad) sin escribir código. La ruta del wizard es `additional-info`.
Doc: `server/data/flows/dynamic-forms/doc.md` · Archivos: `server/data/flows/dynamic-forms/map.json` · Padre: `formalization`

### ecommerce — Ecommerce  ·  _reference_ · 71 archivos
**Cuándo:** Cuando la solicitud entra desde el checkout de una tienda online (VTEX, WooCommerce, desarrollo propio) — hay credencial en `allied_ecommerce_credentials`, contrato base64 del carrito, `/vtex/init`+`/settel`, `ecommerce-request/create/{partner_id}`, notificación al comercio o “volver al comercio” (`return_url`/`process_url`).
Doc: `server/data/flows/ecommerce/doc.md` · Archivos: `server/data/flows/ecommerce/map.json` · Padre: `creditop`

### entities — Entities  ·  _reference_ · 50 archivos
**Cuándo:** Cuando la pregunta es qué ES un prestamista como dato: la fila `lenders`, sus tablas de configuración, y sobre todo el `response_type` (0 redirect/UTM · 1 agregador por API · 2 y 3 CreditopX in-platform · 4 Credifamilia SOAP) que despacha toda la plataforma. Alta de una entidad nueva. También `lender_identity_validation_types` (qué camino de identidad le toca). ⚠ El `response_type` CAMBIA según el ambiente: verificarlo contra local miente (F-95).
Doc: `server/data/flows/entities/doc.md` · Archivos: `server/data/flows/entities/map.json` · Padre: `creditop`

### findings — Findings  ·  _reference_ · 45 archivos
**Cuándo:** Cuando algo NO funciona en el entorno LOCAL y querés saber si ya lo diagnosticamos — pantallas rotas sin mensaje, flujos que se traban, errores que el front se traga, o "esto que veo, ¿es real o es un mock?". También ANTES de invertir tiempo depurando un muro del harness: cada hallazgo trae síntoma, causa raíz verificada, evidencia y arreglo. Es un registro VIVO: al descubrir algo nuevo, se agrega una entrada acá.
Doc: `server/data/flows/findings/doc.md` · Archivos: `server/data/flows/findings/map.json` · Padre: `creditop`

### form-service — Form Service  ·  _reference_ · 35 archivos
**Cuándo:** Cuando la tarea toca el microservicio `form-service` (Go): el formulario dinámico G2 'backend-driven' (pantalla `additional-info`), cómo se arma el schema desde las 5 tablas legacy, dónde/cómo se guardan las respuestas (`user_field_values`, EAV), el árbol país→departamento→ciudad de los selects, o agregar/editar un campo sin escribir código. Credifamilia es el `form_type` 6. Síntoma: «formulario no encontrado» = el flujo dinámico sin su schema (F-41).
Doc: `server/data/flows/form-service/doc.md` · Archivos: `server/data/flows/form-service/map.json` · Padre: `dynamic-forms`

### formalization — Formalization  ·  _reference_ · 87 archivos
**Cuándo:** Cuando el problema está DESPUÉS de elegir entidad: plan de pagos, fecha de primer pago, documentos, pagaré, firma con OTP, autorización hasta el Estado 11 y desembolso. Las pantallas del wizard de este tramo son `confirmation`, `payment-schedule`, `first-payment-date`, `payment-reminder`, `additional-info`, `sign-documents`, `otp-validation` y `loan-approved`. Acá caen «falló firmando documentos», «no le llegó el OTP de la firma», «quedó en Pendiente de autorización (estado 10)», «Aprobada no desembolsada (estado 20)», Deceval (pagaré SOAP) y Netco (firma).
Doc: `server/data/flows/formalization/doc.md` · Archivos: `server/data/flows/formalization/map.json` · Padre: `creditop`

### frontend-monorepo — frontend-monorepo  ·  _reference_ · 84 archivos
**Cuándo:** Cuando trabajás en el wizard React (`loan-request-wizard`): pantallas y rutas (`app/routes.ts` declara 134 rutas; el registro canónico es `ROUTE_PATHS` en `route-helpers.ts`), SSR, repositories, paquetes `@creditop`, `data-testid` para pruebas e2e, o a qué backend le pega cada pantalla (`VITE_API_URL`). ⚠ El wizard NO manda logs a Loki: sus logs de ruta salen por OTLP hacia PostHog, así que una pantalla que no llama al backend es invisible para el trazador.
Doc: `server/data/flows/frontend-monorepo/doc.md` · Archivos: `server/data/flows/frontend-monorepo/map.json` · Padre: `architecture`

### hardcodes-entidades — Hardcodes de entidades/comercios (deuda que frena la plataforma)  ·  _reference_ · 101 archivos
**Cuándo:** Cuando la tarea sea INTEGRAR / agregar / parametrizar una entidad (lender) o comercio (allied) nuevo, tocar el flujo de uno existente (Motai/Welli/Bancolombia/Corbeta/Pash/Credifamilia/Meddipay/etc.), o preguntarse por qué un flujo está QUEMADO / CABLEADO / ACOPLADO a un id, por qué CreditOp NO ESCALA o no es config-driven, o vayas a escribir un if por id / array de ids / branch por nombre de lender: el mapa de los 24 acoplamientos hardcodeados que impiden la integración por-config y lo que cuesta des-hardcodear cada uno. DOLOR: leelo ANTES de sumar otro hardcode.
Doc: `server/data/flows/hardcodes-entidades/doc.md` · Archivos: `server/data/flows/hardcodes-entidades/map.json` · Padre: `creditop`

### harness — Harness  ·  _reference_ · 44 archivos
**Cuándo:** Cuando la tarea es «necesito probar / ejercitar / mockear un flujo de originación E2E» — correr un triplete canal→comercio→lender de punta a punta, sembrar/inyectar un perfil aprobado, decidir qué se puede sellar localmente vs. qué lo decide una API externa, o levantar el demo del wizard (2 ventanas / panel). ⚠ `E2E_TARGET` por defecto es `dev`, NO `local` (F-18), y escribir a la BD compartida exige exportar `I_KNOW_THIS_TOUCHES_SHARED_DEV` a mano (F-53). El gemelo que LEE lo que ya pasó es `trazador`.
Doc: `server/data/flows/harness/doc.md` · Archivos: `server/data/flows/harness/map.json` · Padre: `architecture`

### kyc — KYC  ·  _reference_ · 39 archivos
**Cuándo:** Cuando la tarea toca burós o datos de riesgo: score, Experian/Datacrédito, ingreso (Ágil Data, Mareigua, Quanto), identidad, AML, biometría, cifrado del reporte, o armar un usuario sintético para pruebas. Las tablas son `risk_centrals` (el catálogo) y `risk_central_user_data` (lo consultado, ⚠ indexado por `user_id` y NO por solicitud). Síntomas: «dice que los datos no coinciden» (`ONB005`, TusDatos), «no le consultaron el buró», y el AML de TusDatos con su caché de 1 mes.
Doc: `server/data/flows/kyc/doc.md` · Archivos: `server/data/flows/kyc/map.json` · Padre: `onboarding`

### legacy-backend — legacy-backend  ·  _reference_ · 90 archivos
**Cuándo:** Cuando trabajás en el backend nuevo modular: módulos Onboarding/Loans/Identity/Partner/Risk, rutas /api/*, arquitectura V1 y V2, envelope code/message/data, o dónde poner un endpoint nuevo. También cuando el síntoma llega como un CÓDIGO de error del onboarding (ONB002 usuario temporal sin Corbeta, ONB005 TusDatos, ONB040 rate limit) o como un endpoint concreto: `lenders-v2`, `storePersonalInfo`, `validateOtpCodeAndRedirect`, `lender-result`.
Doc: `server/data/flows/legacy-backend/doc.md` · Archivos: `server/data/flows/legacy-backend/map.json` · Padre: `architecture`

### merchants — Merchants  ·  _reference_ · 55 archivos
**Cuándo:** Cuando el problema es 'a este comercio le pasa distinto': configuración por entidad/comercio/sucursal, copia de reglas por sucursal, hash de entrada, credenciales de ecommerce, toggles del comercio. También cuando el comercio cambia la FORMA del flujo y no sólo sus reglas — el caso medido es el setting `corbeta_allieds` (Alkosto 209, K-TRONIX 210, Alkomprar 211, Kalley 311, Creditop 24), que salta el formulario y fabrica la info laboral, y por eso ese comercio no consulta buró.
Doc: `server/data/flows/merchants/doc.md` · Archivos: `server/data/flows/merchants/map.json` · Padre: `creditop`

### microservicios — Microservicios (qué corre además del monolito)  ·  _reference_ · 13 archivos
**Cuándo:** Cuando la tarea toca algo que NO está en `legacy-backend` ni en `legacy-application` y no se sabe dónde vive: «¿quién sirve este endpoint?», «¿qué es este `service_name` que aparece en los logs?», «¿hay un servicio nuevo que hace esto?», «el monolito no tiene este código, ¿dónde está?». Acá está el CENSO de los 14 servicios que emiten logs en producción —medido en Loki, no supuesto—, cuáles están clonados, cuáles indexa el árbol y cuánto pesa cada uno. También la receta para volver a medirlo. Es el nodo que contesta la pregunta previa a cualquier otra: en qué repositorio buscar. Y el que avisa que la app MÓVIL (`financial-health-service`, `MOBA*`) es un producto entero fuera del alcance de este árbol.
Doc: `server/data/flows/microservicios/doc.md` · Archivos: `server/data/flows/microservicios/map.json` · Padre: `architecture`

### motai — Motai  ·  _reference_ · 88 archivos
**Cuándo:** Cuando la tarea es del comercio Motai (allied 158): sus productos renting / rent-to-own / compra (`lenders.product`), Ábaco (validación de ingresos de apps gig) y cómo se prende por lender en `lender_requirements`, el flujo self-service dirigido por `next_step`, la calculadora del renting y del rent-to-own (precio vs interés, y por qué toca el techo de usura), o por qué el selector de tipo de documento no ofrece PEP en una sucursal. OJO si buscás `modos`, `isMotaiRenting`, `merchant_mode` o `partner_modes`: se borraron en la des-motaización (v2) — acá está el modelo nuevo, que es el que corre en producción desde el 2026-08-19. Si la tarea es del SEGUNDO firmante, el nodo es `codeudor`.
Doc: `server/data/flows/motai/doc.md` · Archivos: `server/data/flows/motai/map.json` · Padre: `merchants`

### ms-preapprovals — MS Pre-approvals  ·  _reference_ · 72 archivos
**Cuándo:** Cuando la pre-aprobación de un lender `response_type`≠0 falla o hay que tocar el microservicio Go (`pre-approvals-service`): contrato del servicio (`check` / `me-check` / `lender-attempts` / `docs`), workflow de 4 etapas, matriz de 8 proveedores (adapter+client+strategy por lender), taxonomía de errores, timeouts y caché en `DynamoDB`, y el consumo cliente en el wizard. Es quien decide el badge «Pre aprobado» del marketplace (F-78). Sus logs en Loki son sólo de prod.
Doc: `server/data/flows/ms-preapprovals/doc.md` · Archivos: `server/data/flows/ms-preapprovals/map.json` · Padre: `architecture`

### negocio — Negocio (por qué el sistema es así)  ·  _reference_ · 11 archivos
**Cuándo:** Cuando la tarea toca el PORQUÉ y no el cómo: quién pone la plata, quién cobra, de qué vive CreditOp, a quién hay que tener contento. Leelo ANTES de proponer «simplificar», «parametrizar» o «unificar» — los dos sombreros no son dos configuraciones sino DOS NEGOCIOS: en CreditopX el capital y el pagaré son del COMERCIO y CreditOp cobra por administrar cartera y cobranza (el lender es la marca blanca del comercio, 1:1); en agregadores presta y cobra la entidad. Acá está también lo que el código NO hace aunque el negocio lo dé por hecho: el sistema no descuenta la comisión (solo la muestra), el fondo de garantía cobra pero no hay código que lo reclame a los 90 días, y ni el fondo ni la aseguradora existen como entidad en la BD. Distingue FONDO DE GARANTÍA (reemplaza al codeudor, acumula) de SEGURO DE VIDA (broker, opcional). Trae el vocabulario de producto contrastado contra código (capacitación de Manuela, 2026-06-05): corte rotativo/consumo por ticket, amortización francesa sobre saldo diario, cobranza preventiva vs coactiva, refinanciar≠condonar, y el catálogo del EMBUDO (`creditop_x_user_requests_process_statuses`) que está VIVO y contesta «¿dónde se cae la gente?». Y el requisito real de las alertas: hoy una solicitud caída por una entidad externa se detecta porque el asesor avisa. Y la frontera sistema↔proceso: la liquidación NO la hace el código — otro departamento la sigue a mano desde el «Reporte de Recaudo» (`PaymentCollectReportExport`), que no trae la comisión; el único cálculo de ingreso en código es una tabla hardcodeada dentro del export de Corbeta (F-129). Trae también el roster de A QUIÉN PREGUNTARLE por área (lo más perecedero del árbol, fechado y cruzado contra git), por qué el alta de un comercio tarda una semana (es NEGOCIACIÓN, no configuración — y eso cambia cómo medir el «plug and play»), que el ciclo de plata es mensual con cierre de mes, que la reportería real es Redash sin consulta canónica, y la promesa que hoy no se cumple: la autogestión del comercio. Cubre además el negocio de los AGREGADORES —se le cobra a los DOS lados: al comercio por el marketplace y a la entidad por aparecer y por recibir solicitudes, con el perfil ya enriquecido contra burós, que es el producto—, y la regla de salida: si un comercio se va, CreditOp SIGUE cobrando su cartera viva, así que dar de baja un comercio no puede ser apagar su configuración.
Doc: `server/data/flows/negocio/doc.md` · Archivos: `server/data/flows/negocio/map.json` · Padre: `creditop`

### onboarding — Onboarding  ·  _reference_ · 88 archivos
**Cuándo:** Cuando el problema está ANTES del listado: entrada por hash de sucursal, registro de celular y OTP, creación de la `user_request`, formulario personal y laboral, captura del monto, códigos `ONB0xx` (`ONB002` usuario temporal sin Corbeta · `ONB005` TusDatos · `ONB040` rate limit). Las pantallas del wizard son `solicitar`, `otp`, `personal-info` y `employment-info`. ⚠ Guardar lo laboral es lo que dispara el buró.
Doc: `server/data/flows/onboarding/doc.md` · Archivos: `server/data/flows/onboarding/map.json` · Padre: `creditop`

### payments — Payments  ·  _reference_ · 65 archivos
**Cuándo:** Cuando la pregunta es sobre cómo CreditOp habla con la pasarela de pago — `Wompi` o `Payvalida`: crear/firmar la transacción, el checkout, el polling o webhook de confirmación, la cuota inicial de formalización (el enganche antes de desembolsar, incl. el rebote rt=2 con `initial_fee>0`), el recaudo del préstamo desde la pasarela, los links de pago, o credenciales de gateway. Síntoma: «pagó y no se refleja».
Doc: `server/data/flows/payments/doc.md` · Archivos: `server/data/flows/payments/map.json` · Padre: `creditop` · Usa: `formalization`, `servicing`

### profiling — Profiling  ·  _reference_ · 32 archivos
**Cuándo:** Cuando el usuario cae en la categoría equivocada, o el cupo/enganche/plazo salen mal: las categorías rt=2 y sus reglas (ocupación, edad, salario, continuidad, score). También cuando la pregunta es «¿por qué el listado salió en ESE orden?» o «¿por qué tardó minutos?»: el perfilador ML (H2O, `NEW_PROFILER_ML_HOST`, `predict_w_experian`, timeouts de 15 s) y el snapshot `profiling_reviews` con sus columnas `displayed_lenders`, `hard_rules`, `ML_predictions` y `disbursed_lender`.
Doc: `server/data/flows/profiling/doc.md` · Archivos: `server/data/flows/profiling/map.json` · Padre: `creditopx`

### pullman — Pullman  ·  _reference_ · 13 archivos
**Cuándo:** Cuando la tarea es de Amoblando Pullman (`allied_id` 94) o su entidad CrediPullman (lender 77): el caso `response_type` 2 vanilla y el canónico para pruebas con usuario sintético, más sus hardcodes por comercio.
Doc: `server/data/flows/pullman/doc.md` · Archivos: `server/data/flows/pullman/map.json` · Padre: `merchants`

### redirect — Redirect  ·  _reference_ · 24 archivos
**Cuándo:** Cuando el prestamista es solo un enlace (`response_type` 0, UTM): se arma la `url_utm`, se redirige al sitio del lender y se pierde visibilidad — nadie decide el crédito adentro de CreditOp, así que el desenlace NO se puede trazar. Sistecrédito es el caso típico. Su ramal declara que no espera webhook ni Estado 11.
Doc: `server/data/flows/redirect/doc.md` · Archivos: `server/data/flows/redirect/map.json` · Padre: `entities`

### rotativo — Rotativo (rt=3)  ·  _flujo_ · 13 archivos
**Cuándo:** Cuando la pregunta es sobre el OTORGAMIENTO del cupo rotativo (response_type=3): «¿por qué a este cliente el rotativo le dio cupo 0?», «¿de dónde sale el multiplicador?», «¿por qué la cuota inicial / el FGA de este cliente es esa?», «¿por qué las condiciones que vio en pantalla no son las del cupo que quedó?». Acá viven el multiplicador de riesgo 1-5 (promedio ponderado de 6 variables de Experian + continuidad laboral), el corte duro `multiplier <= 3`, las tablas `creditop_x_profiling_multiplier_risk_vars`/`_rangs`, la cuota inicial y el FGA por nivel (`creditop_x_profiling_down_payment_FGA`), el tope general `lenders.max_rev_credit`, y las DOS implementaciones que divergen (PHP en legacy-application otorga; el SP en SQL alimenta la pantalla de condiciones). NO es para lo que pasa DESPUÉS del desembolso —cartera, causación, cupo que se libera al pagar—: eso es `servicing`. Y NO es la categorización de consumo por tiers: eso es `profiling`.
Doc: `server/data/flows/rotativo/doc.md` · Archivos: `server/data/flows/rotativo/map.json` · Padre: `creditopx`

### servicing — Servicing  ·  _reference_ · 69 archivos
**Cuándo:** Cuando el problema es DESPUÉS del desembolso (Estado 11): cartera, causación de interés, fecha de corte, mora, cobranza, pagos y cupo rotativo. Los 6 crons diarios `UpdateCreditopX*` y el ledger `creditop_x_requests_history`. Ojo: corre 100% en `application`, no en legacy-backend.
Doc: `server/data/flows/servicing/doc.md` · Archivos: `server/data/flows/servicing/map.json` · Padre: `creditop`

### smartpay — SmartPay  ·  _reference_ · 74 archivos
**Cuándo:** Cuando la tarea es de SmartPay: el celular financiado como garantía, IMEI, bloqueo de dispositivo y MDM, salto de AML, desembolso diferido y crons de bloqueo por mora.
Doc: `server/data/flows/smartpay/doc.md` · Archivos: `server/data/flows/smartpay/map.json` · Padre: `merchants`

### trazador — Trazador  ·  _reference_ · 15 archivos
**Cuándo:** Cuando la tarea es «¿qué le pasó a ESTA solicitud y por qué?» y hay que leer o tocar el trazador (playground/trazador): la herramienta de soporte que cruza BD (Redash) con logs (Loki) y arma el recorrido por etapas. Acá viven el mapa de etapas y sub-pasos (mapa/etapas.json, mapa/substeps.json, mapa/ramales.json), la semántica de los estados de user_requests (cierran vs detienen), la evidencia SQL que acompaña cada paso, y los diagnósticos -anclas/-campos/-spans/-validar. También cuando hay que agregar un hito nuevo porque un mensaje de log cae en «eventos sin nombre de negocio». NO es para ejercitar flujos: eso es harness.
Doc: `server/data/flows/trazador/doc.md` · Archivos: `server/data/flows/trazador/map.json` · Padre: `architecture`
