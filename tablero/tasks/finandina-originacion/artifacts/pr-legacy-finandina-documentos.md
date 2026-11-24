feat(CORE-845): documentos de Banco Finandina con sus datos, y el formulario dinámico pide pensionado y los datos PEP

## Qué cambia

**1. Los documentos de Finandina salen con sus datos.**
Finandina (lender `banco-finandina`, producto crédito) firma dos documentos propios generados con pdf-mapper: el formulario de vinculación y los términos y condiciones. Hasta hoy caía en `OnboardingPayloadBuilder`, que no los llena:

- lee la empresa de otros campos, así que salía vacía;
- no lee la actividad económica ni las preguntas PEP;
- no da los montos en letras ni el valor a girar;
- pone la ciudad de firma con una relación rota, así que salía «BOGOTÁ» siempre.

Se agrega `FinandinaPayloadBuilder`, registrado por slug en `CatalogDocumentPayloadResolver`. Parte del payload genérico y agrega:

- **Lo que el cliente contesta en el formulario dinámico de Finandina:**
  - la actividad económica;
  - la empresa;
  - las dos preguntas PEP («SÍ»/«NO»);
  - si responde «Sí», la entidad y las fechas de vinculación y de retiro (d/m/Y).

  Se leen **sólo las respuestas de ese formulario** (el form type `finandina-creditop-x-additional-info`, por nombre): el onboarding tiene campos con nombres parecidos («empresa») que no son lo que el cliente contestó para Finandina. Dentro de él se buscan por el **nombre** del campo y su padre, no por id: el formulario se cargó a mano en cada ambiente y los ids no coinciden. La empresa sólo va si la actividad es «Empleado».
- **Los ingresos** que reportan las centrales (`MonthlyIncomeResolver::formalIncome`). El formulario de Finandina no pide ingresos; sin dato de las centrales queda el del genérico.
- **El valor a girar al comercio**, que por ahora es el monto aprobado. Está por confirmar con Finandina.
- **Los montos en letras** del crédito, la cuota, el aval y la prima, en mayúsculas.
- **La ciudad de la firma**, la de la sucursal, y el mes con mayúscula inicial.

**2. El formulario dinámico de Finandina pide lo que falta** (migración `2026_11_24_150000_finandina_form_asks_pensioners_and_pep_details`).
Sobre el form type `finandina-creditop-x-additional-info` (en dev/qa hoy es el 25; en cada ambiente se busca por nombre):

| campo | antes | después |
|---|---|---|
| Actividad económica | sólo «Empleado» | «Empleado» y «Pensionado» (`pensionado`) |
| Nombre de la empresa empleadora (Opcional) | siempre | sólo si la actividad es «Empleado» (`parent_value = empleado`) |
| Debajo de cada pregunta PEP | nada | si responde «Sí»: «Nombre de la entidad», «Fecha de vinculación» y «Fecha de retiro (Opcional)» |

Los tres campos de la vinculación van debajo de **cada** pregunta PEP porque un campo tiene un solo padre, y el diseño los pide cuando responde «Sí» a cualquiera de las dos. El documento toma los de la primera pregunta respondida con «Sí». Van en la misma categoría que su pregunta, o sea, en la misma pantalla.

La migración busca todo por nombre. Si el formulario o un campo no existe, lo registra en el log y sigue sin fallar. No repite lo que ya está. El `down` lo deja como estaba y borra las respuestas de los campos que quita.

## Cómo se probó

- `Modules/Loans/tests/Unit/CatalogDocumentPayloadResolverTest.php`: un caso nuevo, `banco-finandina` resuelve a `FinandinaPayloadBuilder` (16 en verde).

En local, con el esquema de este formulario:
- **El flujo:** autogestión en una sucursal de Finandina hasta el estado 11 (solicitud 468462), respondiendo «Sí» a una PEP y con actividad «Empleado».
- **El formulario de vinculación** salió con:
  - la empresa, la actividad, las dos PEP y la entidad con sus fechas;
  - los ingresos de las centrales;
  - el valor a girar;
  - la ciudad de la sucursal.
- **Los T&C** salieron con los montos en letras.
- **La firma:** los dos documentos llevan el mismo hash de la firma OTP.

La migración, sobre una copia del formulario igual a la de qa (7 campos):

- **`migrate --path`** deja 13 campos en este orden:
  - residencia (3);
  - actividad;
  - empresa, con padre «empleado»;
  - PEP A con sus 3 hijos;
  - PEP B con sus 3 hijos.

  También agrega la opción `pensionado`.
- **`migrate:rollback --path`** lo deja en los 7 campos de antes.
- **Un nuevo `migrate --path`** vuelve a dejar los 13.

## Para tener en cuenta al desplegar (en este orden)

⚠ **La migración cambia el formulario que ven hoy los clientes de Finandina** apenas se aplica y se reconstruye el esquema (paso 2): pregunta «Pensionado», esconde la empresa si no es empleado y pide los datos de la vinculación si responde «Sí» a una PEP. Lo que no cambia sin el paso 3 son los **documentos**.

1. **Migración** (sólo ésta): `php artisan migrate --path=database/migrations/2026_11_24_150000_finandina_form_asks_pensioners_and_pep_details.php`
2. **Reconstruir el esquema en form-service** (lo sirve desde su caché): `PUT <form-service>/v1/dynamic-form/<id del form type>/schema` (25 en dev/qa). Sin esto el wizard sigue mostrando el formulario viejo.
3. **Para que la firma use estos documentos:**
   - subir las plantillas `vinculacion` y `terminos-y-condiciones` al pdf-mapper-service del ambiente, proyecto `finandina`;
   - poner `lenders.pdf_mapper_project_slug = 'finandina'` en Banco Finandina (la 149 en dev/qa; en producción, la de slug `banco-finandina`);
   - cargar sus filas en `lender_signing_documents`: `vinculacion` y `terminos-y-condiciones` con `generator = microservice` y `template` puesta, más el pagaré como hoy.

   ⚠ La fila **tiene** que llevar `template`, aunque pdf-mapper no la use: sin ella la vista previa y la firma van por el generador viejo y no devuelven nada.

   Sin el paso 3, Finandina sigue firmando sus documentos como hoy: en dev/qa no tiene filas en `lender_signing_documents`, así que el builder nuevo no se usa. En producción hay que comprobarlo antes de cargar las filas.

Por confirmar con Finandina, sin bloquear este PR:
- el valor a girar (hoy el monto aprobado);
- si el aval va en el formulario;
- si los T&C son la versión final.
