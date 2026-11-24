# Finandina · qué datos piden los documentos y de dónde salen

2026-11-24. Cruce de los dos documentos que mandó Finandina (formulario de vinculación y T&C, carpeta de Drive
«Documentos formalización de crédito», y su mapa `Campos_dinamicos_documentos_formalizacion.xlsx`) con lo que tiene
hoy el flujo:

- **Formulario dinámico 25** («finandina-creditop-x-additional-info»), leído en qa.
- **Lo que llena el backend al generar un documento del catálogo**, leído en legacy-backend `origin/main`
  `e98bfe119`. Finandina (149, producto crédito) cae en `OnboardingPayloadBuilder`: no hay un armador propio de
  Finandina, y los montos salen del motor de `PaymentPlanSummaryService`, porque la 149 es tipo 4.

Los ids son los de las plantillas locales del PDF Mapper Studio (`finandina/vinculacion` y
`finandina/terminos-y-condiciones`).

## El formulario dinámico 25 (qa)

| campo | id | tipo | opciones |
|---|---|---|---|
| Departamento de residencia | 184 | lista (árbol del país) | |
| Ciudad de residencia | 185 | lista (depende del departamento) | |
| Dirección de residencia | 186 | texto | |
| Actividad económica | 320 | lista | **sólo «Empleado»** |
| Nombre de la empresa empleadora (opcional) | 321 | texto | |
| ¿Tú, tu cónyuge o familiar hasta 2° grado son PEP? | 322 | sí / no | |
| ¿Tienes participación accionaria en compañía con accionistas PEP? | 323 | sí / no | |

## Dato por dato

**Llega solo** quiere decir que el backend lo llena hoy, sin hacer nada. **Lo tenemos pero no llega** quiere decir que
el dato existe en el flujo, pero el armador del documento no lo lee. **No lo tenemos** quiere decir que no sale de
ningún lado.

| dato (documento) | id | estado | de dónde sale |
|---|---|---|---|
| Fecha de la solicitud (F) | `filing_date` | llega solo | creación de la solicitud (`:232`) |
| Primer nombre, primer y segundo apellido (F) | `first_name`, `last_name`, `second_last_name` | llega solo | `users` (`:119-122`) |
| Nombre completo (T) | `full_name` | llega solo | `users.full_name` |
| Tipo y número de documento (F, T) | `document_type`, `document_number` | llega solo | `users` |
| Dirección, ciudad y departamento de residencia (F) | `address`, `city`, `department` | llega solo | formulario 25, campos 186, 185 y 184 (`:144-146`, `RESIDENCE_ADDRESS_FIELD_IDS`) |
| Correo y celular (F) | `email`, `cell_phone` | llega solo | `users` |
| Ingresos (F) | `monthly_income` | llega solo | campo 87 del onboarding. Por definir: ¿el declarado o el confirmado (Mareigua o Ágil Data)? |
| **Actividad económica (F)** | `economic_activity` | **lo tenemos pero no llega** | campo 320, que ningún armador lee. Y sólo ofrece «Empleado» |
| **Empresa empleadora (F)** | `company_name` | **lo tenemos pero no llega** | el armador lee los campos 199, 191 y 72 (`:167`), **no el 321** de Finandina: sale vacío. El mapa pide validar la razón social con Mareigua y Ágil Data |
| Monto, tasa N.M.V., tasa E.A., plazo, cuota (F, T) | `credit_amount`, `nominal_monthly_rate`, `interest_rate`, `fee_number`, `fee_value` | llega solo | el motor de la entidad; si falla, la solicitud |
| Aval con IVA (T) | `fianza_amount_iva` | llega solo | el motor (vacío sin motor) |
| Prima del seguro de vida (T) | `insurance_quota` | llega solo | el motor |
| **Montos en letras** (crédito, cuota, aval, prima) (T) | `*_letters` | **no lo tenemos** | ningún armador los da. Se calculan a partir del número (Alta tiene la forma `calc_*_words`) |
| Protección Financiera (T) | — | quemado | «N/A» fijo en la plantilla, como pide el mapa |
| Subcomercio (F) | `supplier_name` | llega solo | el comercio de la solicitud (`:164`) |
| **Valor a girar (F)** | `supplier_transfer_amount` | **no lo tenemos** | ningún armador. Por definir cómo se calcula (¿monto aprobado, o menos el aval?) |
| **¿Es PEP? / ¿accionista de PEP? (F)** | `pep_self_or_family`, `pep_shareholder` | **lo tenemos pero no llega** | campos 322 y 323; ningún armador los lee (los PEP que existen son los de Credifamilia) |
| **Entidad, fecha de vinculación y de retiro, si es PEP (F)** | `pep_entity`, `pep_start_date`, `pep_end_date` | **no lo tenemos** | el formulario 25 no los pide (el diseño sí) |
| Día, mes y año de la firma (T) | `signature_day`, `signature_month`, `signature_year` | llega solo | la hora de firmar; el mes sale en palabras («Agosto») |
| **Ciudad de la firma (T)** | `signature_city` | **llega mal** | usa una relación que el mismo código marca como rota (`:257`): sale «BOGOTÁ» siempre. `filing_city` sí usa la sucursal bien (`:154`) |
| Llave de firma (T) | `otp_signature` | llega solo | SHA-256 del OTP, puesto por el flujo de firma del catálogo (`DocumentSigningService.php:218`) |

F = formulario de vinculación · T = términos y condiciones. Las líneas son de `OnboardingPayloadBuilder.php` salvo que
se diga otro archivo.

**Además:** la 149 no tiene todavía filas en `lender_signing_documents`. Sin ellas firma por el camino viejo, y estas
plantillas no se usan.

## Lo que falta hacer de nuestro lado

1. **Formulario dinámico 25:**
   - actividad económica con las opciones que confirme Finandina (y sus códigos);
   - si la persona responde «Sí» a una PEP: entidad, fecha de vinculación y fecha de retiro (opcional).
2. **Backend:** que el armador del documento lea lo de Finandina:
   - actividad económica (320), empresa (321) y las dos PEP (322 y 323), más las tres de PEP nuevas;
   - los montos en letras;
   - el valor a girar, cuando se defina;
   - arreglar la ciudad de firma.

   Puede ser un armador propio de Finandina, como el de Alta, o sumar los ids al genérico.
3. **Catálogo de firma de la 149:** las filas del formulario, los T&C y el pagaré, con las plantillas de pdf-mapper.

## Preguntas para Finandina (vía Oscar)

1. **Actividad económica:** el mapa dice «Empleado, independiente y pensionado», y la política que tenemos dice
   empleados y pensionados, sin independientes. ¿Cuáles van, y con qué códigos?
2. **PEP:** si el cliente responde «Sí», ¿pedimos entidad, fecha de vinculación y fecha de retiro? En el documento
   hoy no tienen marcador (su observación 2).
3. **Empresa empleadora:** ¿la que escribe el cliente (opcional) o la que confirma Mareigua o Ágil Data?
4. **Ingresos:** ¿el que declara el cliente o el confirmado?
5. **Valor a girar:** ¿es el monto aprobado, o el monto menos el aval y otros cobros?
6. **Monto del aval en el formulario:** su observación 4 dice que el formulario lo menciona pero no tiene campo.
   ¿Lo agregamos?
7. **T&C:** el Word traía 21 cambios con control de cambios sin aceptar, y se aceptaron. ¿Es la versión final?
