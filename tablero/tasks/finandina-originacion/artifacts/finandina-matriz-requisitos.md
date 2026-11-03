# Finandina: matriz de requisitos → estado

Fecha: 2026-11-03. Cruza cada requisito de los documentos de Finandina con lo que hay hoy. Los IDs vienen de la
extracción literal de cada documento:

- **PRD:** el PRD «Integración Banco Finandina».
- **FLUJO:** el diagrama de la fase 1.
- **POL:** «Politicas Creditop.pdf», agosto 2026.
- **FORM:** el formulario de vinculación.
- **TYC:** los T&C del crédito de libre inversión.
- **MAPA:** el mapa de campos, versión 27-10.
- **NOTA:** las notas de reunión.

Estado:

- **✓** funciona en local (rama `feat/finandina-originacion-delegada`, suite `harness/suites/finandina.json`);
- **◐** existe un mecanismo pero falta configurarlo, completarlo o comprobarlo;
- **✗** no existe;
- **?** espera una decisión de producto o de Finandina;
- **⊘** es de Finandina, fuera del alcance de Creditop.

⚠ En el riel 4 una regla dura que falla **no saca** a la entidad del listado: la deja con «Probabilidad muy baja».
Toda la política que debe rechazar tiene que vivir en la **preaprobación** (motor de cupo), no en las reglas del
listado.

## 1. Modelo y alcance

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| PRD-01, 09 | Originación completa en Creditop; cartera, recaudo y cobranza de Finandina | ✓ | La 149 es tipo 4 en local |
| PRD-17, 18 · TYC-07 | Administración de cartera, aplazamientos (3 cuotas al año desde el mes 6), cobranza | ⊘ | — |
| PRD-32 | Sin compra de cartera ni retanqueos | ✓ | No hay flujo de compra de cartera en el riel |
| PRD-08 · NOTA-01..03 | Comercios de la fase 1: 14 grupos en el PRD; la weekly del 28-10 habla de «Cuchones» y Pullman, y de Materiales de Credifamilia | ? | Confirmar con qué comercios arranca Finandina, y si la weekly hablaba de Finandina o de Credifamilia |
| PRD-65 · HU1 | Activar o desactivar Finandina por comercio | ◐ | `lenders_by_allieds` y `lenders_by_allied_branches` lo permiten; falta cargarlo para cada comercio |

## 2. Perfil y elegibilidad (debe rechazar en la preaprobación)

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| POL-02, 03 · PRD-20, 21 | Persona natural, un titular, cédula de ciudadanía | ◐ | `document_types = ["CC"]` en la 149 ✓. Pero el mapa dice «CC/CE» (MAPA-5) ? |
| POL-04 · PRD-22 | 21 a 64 años | ◐ | Regla dura en local (sólo clasifica). Falta en la categoría del motor (`min_age`/`max_age`) y decidir si es al solicitar o al terminar ? |
| POL-05, 06 · PRD-23, 24 | Empleados (CIIU 0010) y pensionados (0020), sin independientes | ◐ | Regla dura en local (clasifica). Falta en el motor. El mapa 27-10 dice «Empleado, independiente y pensionado» ? |
| POL-08 · PRD-25 | Ingresos desde 1 SMMLV | ◐ | Regla dura con 1.423.500 PROVISIONAL. Falta en el motor (`monthly_income`, se actualiza cada año) |
| POL-09, 10 · PRD-26, 27 | Antigüedad: empleados 6 meses validada con Mareigua; pensionados no aplica | ◐ | `employment_continuity` existe. Si responde Ágil Data no se mira Mareigua |
| POL-07, 43 · PRD-28 | Cobertura: 99 zonas de la Tabla 5 con código DANE | ✗ | `cities_by_lender` existe y nadie la lee; la ciudad casi no se captura. Errores de la tabla: Bosa con el DANE de Bogotá; códigos de Antioquia sin el 0 inicial; homónimos (Barbosa, Rionegro, Restrepo). Falta decidir si manda la Tabla 5 o la lista «ciudades principales» ? |
| POL-11, 12 · PRD-29 | Experiencia: carteras de más de 12 meses con una obligación ≥ 3 MM, o deudas vigentes o canceladas hace ≤ 48 meses por ≥ 3 MM | ✗ | `financial_history_length` cubre los 12 meses; el monto ≥ 3 MM no existe. Falta decidir si los bullets se combinan con Y u O, y si es saldo o monto original ? |
| POL-13 · PRD-30, 42, 87 | Sin experiencia: máximo 5 MM | ✗ | Falta definir qué es «sin experiencia» ? y crear una categoría aparte con `max_amount` |
| POL-14, 15 | Score Advance 1.1 ≥ 646, y también score 0 | ◐ | `lender_datacredito_rules` 646 + `allow_0_score` en local. ⚠ El score que usa el sistema es el PROMEDIO de los modelos del HDC+, no el Advance 1.1. Falta decidir si el corte es ≥ o > ? |
| PRD-44..46, 83 · HU6 | Mareigua: riesgo del empleador; se aceptan bajo y medio, se rechazan alto y «document» | ✗ | `nivel_riesgo` viene en la respuesta y nadie lo lee. Falta definir los «estados no concluyentes» (PRD-84) ? |
| FORM-13 · MAPA-13 | Validar la razón social del empleador con Mareigua y Ágil Data | ✗ | El mapa no dice qué hacer si no coincide ? |
| PRD-34, 35 | Sin 2 libre inversión activas con Finandina; con una activa, mínimo 3 cuotas pagas | ✗ | Sólo lo sabe Finandina: hace falta un servicio o un archivo suyo ?. La política de agosto no lo trae |

## 3. Monto, capacidad de pago y límites

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| POL-16..18 · PRD-37..39 | Monto 3–15 MM (PRD: 1–15 MM), plazo 6–36 meses | ✓ / ? | Línea local de 3–15 MM a 6–36 ✓. Mínimo de 1 MM o de 3 MM ? |
| POL-24 + tabla · PRD-40 | Veces el ingreso por segmento de riesgo (AA…Z) y SMMLV: de 3 a 10 (PRD: de 3 a 16) | ✗ | Los segmentos no existen en ningún repo. La fila AA está duplicada (0 y 10 en «>4»). Los bordes 1,5, 2 y 4 se solapan. Un 0 ¿es rechazo? ? |
| POL-27..33 · PRD-47..51, 89 | Capacidad = ingresos − descuentos de ley − gastos personales − cuotas financieras | ◐ | Hoy es un `life_percentage` plano por categoría, con las cuotas de Experian. Falta la tabla de gastos (Tabla 1) y de ley (Tabla 2) por SMMLV, y la cuota potencial (Tabla 3) |
| Tabla 3 | Cuotas reales y potenciales por tipo de cartera: TDC y CBR potencial = cupo×0,022 + cupo/24; SBG sólo potencial; CAC y CAV al 50 % | ✗ | Falta definir el «cupo» (total o disponible) y la lectura de la Regla B ? |
| POL-26 (sin umbral) | Cómo se compara la capacidad con la cuota del crédito nuevo | ? | **La política no lo dice.** Sin eso el motor no puede decidir el monto. Es la pregunta más importante para producto |
| POL-19, 28 · PRD-52, 90 | Tasa de modelación: «vigente del mes confirmada por Finandina» (PRD: 1,79 %, sin periodicidad) | ◐ | 1,79 % N.M. PROVISIONAL en la línea local. Falta quién la actualiza cada mes y por dónde ? |
| PRD-53, 88, 91, 92 · POL-38 | Configurable, versionada y auditable; el resultado se persiste para auditoría; política «espejo» con monitoreo | ◐ | `users_category_log` guarda el cupo y los criterios, no los componentes del cálculo. El monitoreo no tiene dueño ni frecuencia ? |
| POL-25 · PRD-33 | Máximo 2 créditos por Creditop al mes por cliente | ✗ | Falta definir si es sólo Finandina o todas las entidades, y si es mes calendario o 30 días ? |
| POL-26 · PRD-36, 67, 96 | Tope de desembolsos: 2.000 MM al mes (PRD: 500 MM al día) | ✗ | No hay tope por entidad |
| PRD-93, 97 · HU9, HU11 | El monto aprobable es el cupo del cliente | ◐ | Hoy el `max_amount` del plan es el tope de la línea (15 MM para todos). Falta conectar la preaprobación de la 149 con el motor de cupo |

## 4. Condiciones del crédito (plan de pago)

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| FORM-17, 18, 19 · TYC-02 | Tasa fija N.M.V. y E.A. | ✓ | 1,79 % N.M. = 23,73 % E.A. en el resumen local |
| POL-21 · TYC-10 | Seguro de vida: 1.660 por millón desembolsado, prima mensual | ✓ | 9.189 al mes sobre 5.535.500 en local |
| POL-22, 23 · TYC-06 · TYC-08 | Aval FGA: 5 % con Advance ≥ 856 y 9 % para el resto. «IVA incluido, calculado sobre el valor aprobado». Se financia en el capital y no se devuelve en prepago ni retracto | ◐ / ? | Hoy es 9 % fijo y el motor le **suma** IVA (450.000 + 85.500). Si «IVA incluido» quiere decir que va dentro del 9 %, hoy se cobra de más ?. El 5 % por score no tiene dónde vivir (el convenio tiene un solo %). Falta el FGA de los clientes con score 0 ? |
| TYC-15 | Días de pago 5, 10, 15 o 20; el cliente puede cambiarlo | ◐ | Están en el perfil, pero `PaymentPlanDatesService::DATES_TO_RETURN = 2` muestra sólo las dos próximas. Falta que la cantidad salga del perfil |
| TYC-05 | La primera cuota en la fecha elegida; la última recoge el saldo | ◐ | Lo hace el motor del riel; no se comprobó la última cuota |
| TYC-11 · MAPA T&C 12, 13 | Protección Financiera, opcional: «Quemar en N/A» | ? | El mapa la quema y los T&C (n.º 10 y 18) la mantienen |
| TYC-13 · FORM-60 | Costos al capital: estudio, ACH, cheque y GMF | ? | El riel no tiene esos costos. ¿Aplican? |
| 4x1000 | No está en la política | ✓ | Apagado en el perfil |

## 5. Identidad y consultas

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| POL-41, 42 · FLUJO-07 | ADO: biometría (rostro, huella, iris), listas restrictivas y antifraude, más OTP | ◐ | ADO configurado como en Credifamilia. `requires_restrictive_list_check` no lo lee nadie. El diagrama pone la identidad **después** de aprobar y el PRD **antes** ? |
| PRD-11, 43, 77 · FLUJO-05 · NOTA-04..10 | Experian y Mareigua con las llaves de Finandina | ✗ / ? | La consulta nueva de Experian sólo usa config (RKV2TD024) y Mareigua tiene una sola cuenta global. El gateway de febrero (`kyc-gateway`) no tiene credenciales por entidad en `main` |
| PRD-80 · HU5 | «Creditop no genera cobro por esta consulta» | ? | Implica que la consulta se factura a Finandina: refuerza consultar con sus llaves |
| PRD-78, 79 | Timeout, errores y registro en logs de la consulta | ◐ | Existe para las consultas actuales; falta para la de llaves propias |
| PRD-72 · FLUJO-04 · FORM-32..38 | Consentimiento de datos: Finandina responsable, Creditop encargado; ADO para la biometría; Experian, PILA y nómina | ◐ | El texto va en el formulario; falta el momento y el registro del consentimiento para Finandina |

## 6. Documentos y firma

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| FLUJO-08 · PRD-61, 100 | Se firman el formulario de vinculación, los T&C y el pagaré | ✗ | La 149 no tiene documentos (`lender_signing_documents`) ni proveedor de firma |
| FORM-01..14 · MAPA 1-14 | Datos personales | ◐ | Nombre, documento, correo, celular e ingresos existen. **Faltan** en el formulario dinámico dirección, ciudad y departamento (MAPA 7-9). No hay segundo nombre |
| FORM-16..23 · MAPA 15-22 | Condiciones: monto, tasas, plazo, cuota, valor a girar, subcomercio | ◐ | Salen del resumen del plan. Falta definir de dónde salen `[ValorGirar]` y `[NombreSubComercio]` |
| FORM-29..31 · MAPA 23, 24 | Preguntas PEP A y B, y entidad y fechas si responde «Sí» | ✗ | Comparten el marcador `[SI/NO]`; no hay marcadores para entidad y fechas; faltan en el formulario dinámico |
| FORM-24 · TYC-06 · MAPA T&C 8, 9 | Monto del aval | ✗ | El formulario no tiene marcador; los T&C sí (`[$MontoAvalLetras]` lleva `$` dentro del corchete) |
| TYC-01..20 · MAPA T&C | 15 marcadores de los T&C, montos en letras | ✗ | Plantilla y armador de datos nuevos. La firma de los T&C trae fecha, ciudad y huella en blanco, sin marcador |
| TYC (control de cambios) | El docx tiene cambios sin aceptar; el pdf ya los acepta | ? | Confirmar que la versión final es la del pdf |
| TYC-09 | Cláusula de libranza («para crédito de libre inversión por libranza») | ? | ¿Aplica al canal Creditop? |
| FORM-27 · TYC-14 | Desembolso: el formulario fija «Pago en línea / Creditop / SubComercio»; los T&C dejan elegir al cliente (cuenta, cheque o abono) | ? | Contradicción entre documentos |
| POL-39, 40 · FLUJO-09 · FORM-47 | Pagaré desmaterializado en Deceval, beneficiario Banco Finandina, Ley 527 | ◐ | En local funciona con una credencial de Deceval de PRUEBA de la 149. Falta la credencial real y la certificación (CRED-463 bloqueada) |
| PRD-101, 102 · HU12 | Manejo del error de firma y confirmación al usuario | ◐ | Existe en el riel para Credifamilia; no se probó con la 149 |

## 7. Decisión, entrega y después

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| PRD-59, 94 · HU10 | Decisión automática aprobado / rechazado | ◐ | Hoy la 149 siempre «aprueba» (insumos de configuración). Falta la preaprobación por el motor de cupo |
| PRD-98 · HU11 | Mensaje claro si rechaza | ◐ | La tarjeta muestra «Rechazado»; falta el texto propio ? |
| PRD-62, 103..105 · HU13 · FLUJO-11 | Enviar la operación a Finandina, con payload validado, confirmación de recepción y manejo de errores; «notificación automática a bfa» | ✗ | Clase de formalización de Finandina. Falta el canal ? |
| FLUJO-10, 15 | Desembolso: el diagrama dice «en línea al comercio» por Creditop y después «Giro al aliado» por Finandina | ? | Contradicción: ¿quién le paga al comercio y cuándo? |
| FLUJO-12..14 | Lo manual de Finandina: el dashboard semanal, la conciliación y la PQR masiva | ◐ / ⊘ | Lo de Finandina es ⊘. El dashboard o export de Creditop es ✗ |
| PRD-106 · HU14 | Pantalla final: próximos pasos, soporte, «en proceso de desembolso» | ✗ | Diseño ? |
| PRD-107, 108 · HU15 | Admin: el comercio ve las solicitudes y desembolsos de Finandina | ◐ | El admin muestra solicitudes; falta comprobar el filtro de Finandina |
| PRD-63 | Métricas: conversión por comercio, desembolsos, ticket y revenue | ◐ | Salen de la base; falta el tablero |
| — | Qué estado es «autorizada» para Finandina | ? | Hoy queda en 11 sin radicar |

## 8. Insumos y credenciales

| ID | Requisito | Estado | Qué falta |
|---|---|---|---|
| — | Llaves de Experian, Mareigua y Deceval de Finandina | ✗ | Que lleguen por un canal seguro (hoy están en Drive) y se carguen desde el admin |
| — | `POST /api/onboarding/credentials/get-by-lender` devuelve credenciales descifradas sin autenticación | ✗ | Confirmar la exposición con quien conoce el gateway |
| PRD-76, 99 | «UX alineado con Figma» | ✗ | No hay Figma |

## Contradicciones para producto (una sola lista)

1. **Monto y veces el ingreso.** Mínimo 1 MM (PRD) o 3 MM (POL), y de 3 a 16 veces (PRD) o de 3 a 10 (POL). Tope de 500 MM diarios (PRD) o 2.000 MM mensuales (POL).
2. **Comparación de la capacidad con la cuota.** Falta el umbral: cómo se compara la capacidad de pago con la cuota del crédito nuevo.
3. **Segmentos AA…Z.** De dónde salen, qué fila AA vale y qué significa un 0.
4. **Experiencia crediticia.** Y u O, saldo o monto original, y qué es «sin experiencia».
5. **FGA.** Si el IVA va dentro del porcentaje, y qué FGA le toca a un cliente con score 0.
6. **Cobertura.** Si manda la Tabla 5 o la lista de «ciudades principales», y la corrección de Bosa.
7. **Actividad económica.** Independientes sí (mapa) o no (política).
8. **Desembolso.** Quién le paga al comercio (diagrama), y si el formulario fija el pago en línea o el cliente elige (T&C).
9. **Identidad.** Si va antes de la decisión (PRD) o después (diagrama).
10. **Consultas.** Si van con la cuenta de Finandina y quién paga.
11. **Mareigua.** Qué son los estados no concluyentes y el «document».
12. **Productos y costos.** Protección Financiera, libranza y costos al capital.
13. **Límites.** El límite de 2 créditos al mes, y si existe la regla de las obligaciones con Finandina.
14. **Comercios.** Con cuáles arranca Finandina.
15. **Tasa.** Quién confirma la tasa de cada mes y por dónde llega.
