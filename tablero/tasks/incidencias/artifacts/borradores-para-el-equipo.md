# Borradores para socializar con el equipo · 2026-11-03

Incidencias encontradas al revisar el código de `main` y medidas en producción (sólo lectura) o corridas en local.
**Nada de esto está en Jira ni tiene cambios hechos**: es para conversarlo con el equipo y decidir dueño y arreglo.
Los comandos con que se midió cada una están en la tarea `incidencias` del tablero de Miguel.

Cada borrador dice: qué pasa · a quién afecta y cuánto · cómo se comprobó · cómo se reproduce · una propuesta.

---

## 1 · Clientes del KYC nuevo quedan con continuidad laboral 0 aunque Mareigua tenga sus meses (Alta)

**Qué pasa.** Cuando Ágil Data no tiene información de la persona, el pipeline nuevo de KYC guarda su resumen como
una lista vacía. El motor de perfiles toma «Ágil Data o, si no hay, Mareigua», pero una lista vacía no cuenta como
«no hay», así que nunca mira Mareigua y la continuidad laboral da 0. Los perfiles que piden continuidad dejan afuera
a ese cliente. El flujo viejo no tiene el problema: ahí se guarda vacío como nulo y sí cae a Mareigua.

**Cuánto.** En producción se guardan así unos 2.700 resúmenes por mes (2.656 en octubre, 54 en los primeros días de
noviembre); 555 de los 2.726 tienen 12 meses en Mareigua.

**Cómo se comprobó.** Corrido en local: un cliente con Ágil Data vacía y Mareigua con 6 meses de continuidad, por el
pipeline nuevo, queda con continuidad calculada 0. El mismo cliente por el flujo viejo queda con Mareigua y sale en
la categoría alta.

**Dónde.** `legacy-backend` · `Modules/Loans/App/Services/LenderUserCategoryService.php` (`getContinuity`: `agildata ??
mareigua`) y `Modules/RiskV2/App/Extractors/RiskCentral/AgildataExtractor.php` (`summarise` devuelve `[]` sin datos).

**Propuesta.** Que `getContinuity` trate una colección vacía como ausente, o que el pipeline guarde nulo. Una línea en
cualquiera de los dos lados.

---

## 2 · SmartPay: dos respuestas del formulario nunca suman puntos (Alta)

**Qué pasa.** La política de puntaje de SmartPay compara el texto exacto de la respuesta. Dos opciones no coinciden
con lo que guarda el formulario: el rango «RD$40,001 – RD$50,000» está escrito con raya larga y el formulario guarda
guion, y «Trabajo en delivery o plataformas» no existe en el formulario (que guarda «Conductor de plataforma
digital»). Quien elige esas opciones suma 0 en vez de 15 o 10.

**Cuánto.** De 38 clientes con ese rango de ingreso, 14 quedaron en una categoría peor de la que les correspondía
(más cuota inicial y más tasa). Verificado con una evaluación real: el log guardó 90 puntos y le correspondían 105.

**Además.** Dos rangos de capacidad de pago se pisan en 50 (uno da 15 puntos y el otro 10), y el código toma el
primero que devuelva la base, sin orden.

**Propuesta.** Corregir los textos de la política (es un cambio de datos, no de código) y los rangos que se pisan.

---

## 3 · El desembolso de un equipo con IMEI no revisa en qué estado está la solicitud (Seguridad)

**Qué pasa.** La ruta que desembolsa un equipo (`POST api/loans/requests/device/{id}/disburse`) no pide sesión ni
revisa el estado de la solicitud: sólo que tenga un IMEI guardado. Para SmartPay lleva la solicitud a «autorizada»
sin mirar si estaba cancelada o ya desembolsada. Si ya estaba autorizada, vuelve a generar el PDF, el plan de
pagos, el correo y el comprobante, y vuelve a cancelar los otros créditos del cliente. El id de la solicitud es
secuencial.

**Cómo se comprobó.** Corrido en local, con una solicitud de prueba de SmartPay cerrada por el canal del equipo:

| paso | respuesta | estado | registros «Desembolso IMEI» |
|---|---|---|---|
| desembolso normal | 200 | 11 | 1 |
| repetir el desembolso sobre la ya autorizada | 200 «Crédito desembolsado correctamente» | 11 | 2 |
| cancelarla (8) y repetirlo | 200 «Crédito desembolsado correctamente» | **11** | 3 |
| la ruta normal de autorización, sobre la misma | **403** «CREDIT_ALREADY_DISBURSED» | 11 | 3 |

Las llamadas fueron sin sesión, sólo con el id. El histórico del crédito no se duplicó (esa parte tiene guarda).

**Propuesta.** Decidir con el equipo qué guarda va: el estado esperado (como la ruta normal de autorización), una
sesión o un token del flujo.

---

## 4 · Créditos autorizados sin que la identidad haya terminado (Media)

**Qué pasa.** En los comercios que usan el KYC nuevo, ni el listado de entidades ni la solicitud revisan que la
validación de identidad haya terminado: la única guarda es la pantalla. En el comercio 26 hay 5 solicitudes
autorizadas desde octubre con el cliente todavía como «TEMPORAL USER».

**Falta saber** si esas entidades validan identidad por su lado.

**Propuesta.** Decidir con producto si el backend debe frenar el listado sin identidad terminada.

---

## 5 · La sucursal de ecommerce de un comercio de otro país nace en una ciudad de Colombia (Media)

**Qué pasa.** Al crear la sucursal de ecommerce, los dos monolitos le ponen siempre la ciudad «TODAS LAS CIUDADES»
de Colombia, sea cual sea el país del comercio. Los documentos imprimen «BOGOTÁ» para esa ciudad.

**Cómo se comprobó.** Corrido en local con un comercio peruano: la sucursal nació en la ciudad comodín de Colombia.
En producción hay tres sucursales con ciudad de otro país (dos de comercios peruanos en Bogotá).

**Propuesta.** Usar la ciudad comodín del país del comercio.

---

## 6 · Dos sucursales activas no reciben solicitudes porque comparten código con otra (Media)

**Qué pasa.** El código (hash) de cada sucursal se arma con la hora al segundo y no se exige que sea único. Dos altas
en el mismo segundo dan el mismo código, y el sistema siempre resuelve la primera.

**Cuánto.** En producción hay 4 pares de sucursales con el mismo código; en cada par la segunda tiene 0 solicitudes.
Dos de ellas están activas: «CC CENTRO MAYOR» (comercio 76) y «1402-Bqlla Cl 76» (comercio 41).

**Propuesta.** Generar el código al azar con chequeo de unicidad (ya existe una función así para otra alta) y darles
a esas dos sucursales su propio enlace.

---

## 7 · El cupo de CreditopX se cae si Experian manda las tarjetas como nulo (Baja · robustez)

**Qué pasa.** Una validación del motor de perfiles recorre las tarjetas de crédito del reporte de Experian sin
contemplar que vengan como nulo; otras dos validaciones del mismo archivo sí lo contemplan. En producción no pasa
hoy (Experian real no manda ese nulo: 0 casos en 24 horas), pero el simulador de qa sí, y ahí el cupo se caía.

**Dónde.** `LenderUserCategoryService.php`, línea 1298.

**Propuesta.** Tolerar el nulo como las otras dos validaciones. Una línea.

---

## Sobre originación delegada (CORE-918)

Lo que sigue va con la tarea de originación delegada, no con incidencias, pero conviene conversarlo junto:

- **En el front de qa, la tarjeta de Credifamilia Materiales sale en error** («No pudimos consultar esta entidad»):
  el front sólo espera y reintenta la preaprobación de Credifamilia Salud. Visto en qa el 2026-11-03.
- **Para llevar Materiales a producción falta:** el alias de preaprobación en `main` de pre-approvals-service, los
  estados de transacción del 214, su tabla de porcentajes FNG, y correr las migraciones de perfil y slug con
  `APP_ENV=production` (con otro valor se cargan sobre otra entidad).
- **El front de qa se presenta como escritorio ante el backend** en una de sus consultas, y eso podría mandarle al
  cliente el mensaje de «continuar en el celular». Falta comprobar si pasa en producción.
