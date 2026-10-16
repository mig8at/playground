---
id: 101
title: "Ajuste de nombres en el onboarding v1 y v2"
stage: work
created: "2026-10-16T11:00:00-05:00"
knowledge: [identity-name-validation, kyc-pipeline]
canon: []
jira: []
jira_title: "Ajuste de nombres en el onboarding v1 y v2"
ramas: "fix/kyc-name-adoption, fix/kyc-v2-name-adoption, fix/kyc-remove-name-revalidation"
---

## Pendientes

- [ ] Mergear el arreglo del camino v1 a main; termina cuando legacy-backend#1666 esté mergeado y desplegado a producción.
  Depende de: revisión del equipo — aprobación del PR.
- [ ] Mergear el arreglo del pipeline v2 a main; termina cuando legacy-backend#1671 esté mergeado y desplegado a producción.
  Depende de: revisión del equipo — aprobación del PR.
- [ ] Probar el pipeline v2 completo en qa; termina cuando un cliente de prueba de Mediarte quede con el nombre completado y con Ñ por el recorrido entero.
  Depende de: infra (Yamid) — que el servicio de perfilamiento de qa llame al backend de qa (hoy llama al de develop).
- [ ] Correr `kyc:repair-adopted-names` en producción, primero sin `--apply`; termina cuando el CSV aplicado quede guardado y el conteo registrado en la pila.
  Depende de: alguien con acceso a producción.
- [ ] Corregir a mano las tres cédulas del reclamo de Credifamilia y reenviar sus documentos; termina cuando la entidad confirme.
  Depende de: operaciones — reenvío de documentos.
- [ ] Actualizar «Reglas generales → Correcciones» en Confluence (completar el nombre donde no hay que adivinar); termina cuando la página lo diga.
- [ ] Decidir con producto qué hacer cuando sólo resuelve TusDatos y el nombre llega incompleto.
  Depende de: producto — decisión.

## Objetivo

El nombre que queda guardado y se radica es el de la persona: con su Ñ y sus tildes, y completo cuando la
central lo trae completo y no hay que adivinar dónde va cada palabra. Igual en el camino v1 (la cascada
dentro del backend) y en el v2 (el pipeline del servicio de perfilamiento). Los nombres que ya quedaron
mal se corrigen en la base, sin volver a consultar centrales.

## Dónde se toca

- v1: `legacy-backend` `Modules/Identity/App/Services/NameSimilarity.php` (`alignedSplit`, `keepEnteredAccents`,
  `adoptSplit`), `AgildataService.php`, `MareiguaService.php`, `KycNameCheckRecorder.php`.
- v2: `legacy-backend` `Modules/CommonsV1/App/Utils/NameUtils.php` (copia de la regla) y
  `Modules/RiskV2/App/Identity/RiskCentral/{Agildata,Mareigua}IdentityValidator.php`.
- Corrección de lo guardado: `Modules/Identity/App/Services/StoredNameRepairService.php` y
  `app/Console/Commands/RepairAdoptedNamesCommand.php`.

## Cómo se ataca

1. v1: conservar Ñ/tildes y completar los grupos 1 y 2 — legacy-backend#1666 a main (validado en qa por #1662 y #1663).
2. v2: la misma regla en NameUtils — legacy-backend#1671 a main (en qa por #1672).
3. Corregir lo guardado con el comando, en producción.

## Lo que se evaluó y NO se eligió

**Revalidar el nombre en cada solicitud de un cliente existente.** Se implementó (#1662) y se quitó (#1663):
un cliente registrado no se vuelve a consultar; corregía con lo guardado y, sin respuesta guardada,
consultaba una central. Lo guardado mal se corrige con el comando.

**Completar también cuando la palabra de más está entre nombre y apellido.** Es ambiguo (¿2º nombre o 1er
apellido?); se sigue pidiendo corregir.

## Lo que NO entra

- Clientes sin respuesta de central guardada: corrección manual.
- El caso «sólo resuelve TusDatos» (no devuelve nombres): decisión de producto aparte.
- La configuración del servicio de perfilamiento en qa: es de infra.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

- v1 en local o qa: `make harness-case LAMBDA=1 CASES='pullman@name=…,surname=…,agilname=…'` y leer `users`.
- v2 en local: `make harness-pipeline` y `make harness-pipeline-run` (14 casos: Ñ, tildes, ortografía, nombres incompletos, ambiguos y la cascada; `A=stop` para bajarlo).
- v2 en qa, sólo el backend: `POST /api/v2/risk/identity-check/agildata/{userId}` contra `legacy-backend-qa`.

## Referencias

- Origen y mediciones: tarea 47 (CORE-420), que trae la investigación, las mediciones de producción y las pruebas.
- legacy-backend#1666 (v1, main) · #1671 (v2, main) · #1662, #1663, #1672 (qa).


## Tarea (publicable)

## En una línea

El nombre del cliente se guarda y se radica con su Ñ y sus tildes, y completo cuando la central de riesgo
lo trae completo, tanto en el flujo actual como en el flujo nuevo de validación.

## Por qué

Una entidad reportó documentos radicados con el apellido sin Ñ o sin el segundo apellido. Desde mediados de
septiembre, al tomar el nombre de la central se perdían la Ñ y las tildes, y si la central traía el nombre
completo pero el asesor había escrito menos, se descartaba y quedaba incompleto. En producción, los
apellidos sin Ñ pasaron de unos 20 al mes a 200 en septiembre, y 386 personas quedaron con el nombre
incompleto. En el flujo nuevo, además, un nombre incompleto frenaba al cliente pidiéndole corregir.

## Qué cambia

- Se conservan la Ñ y las tildes que escribió el asesor cuando la central no las trae; si la central las
  trae, se usan las de la central.
- Si la central trae el nombre completo, se completa en los casos sin ambigüedad: falta el segundo
  apellido, o faltan el segundo nombre y el segundo apellido. Si no se puede saber dónde va la palabra que
  falta, se sigue pidiendo corregir.
- Un cliente que ya existe no se vuelve a consultar; los nombres ya guardados mal se corrigen en la base
  con la información que ya tenemos, sin tocar clientes con crédito desembolsado.

## Alcance

Flujo actual y flujo nuevo de validación de identidad, y la corrección de los nombres ya guardados.

## Dónde probar

- Flujo actual: ambiente qa, solicitud por asesor, pantalla de datos personales.
- Flujo nuevo: hoy sólo se puede probar de punta a punta en el ambiente local; en qa, el servicio de
  validación de identidad consulta al backend de dev.

## Cómo validar

- Escribir un apellido con Ñ (MUÑOZ) cuando la central lo devuelve sin Ñ: queda MUÑOZ.
- Escribir un nombre y un solo apellido cuando la central trae dos nombres y dos apellidos: queda completo.
- Escribir un nombre y dos apellidos cuando la central trae dos nombres: se pide corregir.

## Cambios en datos

La corrección de nombres ya guardados se hace una vez, con un listado previo de lo que cambia y la
posibilidad de deshacerlo.

## Criterios de aceptación

- Ningún nombre adoptado pierde Ñ ni tildes que el asesor escribió.
- Los nombres incompletos se completan sólo en las formas sin ambigüedad.
- Un cliente existente no se vuelve a consultar.

## Dependencias / contraparte

Revisión del equipo para los cambios; infra para probar el flujo nuevo en qa; operaciones para reenviar
los documentos de los clientes del reclamo.
