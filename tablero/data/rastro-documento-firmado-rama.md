---
id: 62
title: "La evidencia del documento firmado apunta a la fila de catálogo equivocada"
stage: work
created: "2026-08-22T18:00:00-05:00"
context_nodes: [codeudor, motai]
jira: []
jira_title: "Firma: el registro de evidencia guarda la fila de catálogo de la otra rama de política"
---

**ESTADO 2026-08-22.** Diagnosticado, arreglado y probado **en local**, en la rama
`fix/rastro-documento-firmado-rama-de-politica` de `legacy-backend` (a partir de `main`,
**sin pushear**). Queda esperando que se pida la tarea. El hallazgo del sistema es **F-154**.

## Cómo apareció

Mirando en prod el alcance del hueco de documentos del Rent to Own (**F-152**), no del defecto en sí.
La solicitud `533540` tenía sus cinco documentos firmados apuntando a filas de catálogo de **las dos
ramas** — se leía como «el cliente firmó el contrato equivocado».

**No lo era, y confundirlas costó una conclusión.** La prueba estaba en los mismos datos: la solicitud
incluye `chattel_mortgage`, que existe **sólo** en la rama con codeudor. Si el resolver hubiera
devuelto la otra rama, ese documento no se habría generado. O sea que el juego entregado fue el
correcto y lo que miente es el rastro.

## Qué está mal

`SigningDocumentRecorder::catalogEntryId()` busca la fila por `(lender_id, signer_role, document_type)`
y cierra con `value('id')` sin `orderBy`. Desde que el catálogo tiene `requires_cosigner`, esa tupla ya
no identifica una fila: los tipos que viven en las dos ramas devuelven dos, y gana el id más bajo — el
de la rama sembrada primero. **El sesgo es sistemático, no aleatorio.**

Medido en prod: **18 documentos firmados** con el rastro cruzado, **15 de Motai Renting** y 3 del Rent
to Own. No es del producto nuevo: es de cualquier entidad cuyo catálogo se haya sembrado en dos tandas.

## Qué se hizo

La política baja como parámetro desde `generateAllDocuments` hasta `catalogEntryId`, que la suma al
filtro. **No se recalcula**: evaluarla corre reglas y consulta centrales, y la generación ya la paga
una vez — por eso se sube al método externo y se calcula sólo en el camino que la usa. El camino
SmartPay/IMEI no pasa por el catálogo y viaja en `null`, que conserva el comportamiento anterior en vez
de inventar una rama.

**Cómo se probó** (no hay test que lo cubra: el unitario del recorder es puro y declara que la parte de
BD se prueba en integración). A/B contra la BD local dentro de una transacción revertida, con el
catálogo del Rent to Own sembrado en las dos ramas como lo tiene producción:

| | rama registrada | plantilla |
|---|---|---|
| `main` | 0 | `contrato_renting_sin_codeudor` |
| con el cambio | 1 | `contrato_rto_con_codeudor` |

Mismos datos, misma solicitud: **lo único que cambia es el código.** Y las tres suites de firma
(`SigningDocumentRecorderTest`, `DocumentSigningServiceTest`, `SigningDocumentResolverTest`) siguen en
**19 en verde**, igual que en `main`.

## Lo que queda abierto

- **Falta el test de integración** que cubra `catalogEntryId` con las dos ramas. Hoy no existe y por eso
  el defecto entró sin que nada lo notara.
- **Los 18 documentos ya firmados en prod siguen con el rastro cruzado.** Arreglar el código no los
  corrige: si esa evidencia se va a usar para algo (auditoría, disputa, reporte), hace falta decidir si
  se re-mapean. Es decisión de negocio.
- **No confundir con F-152**, que sí es un hueco real de configuración y sigue vivo: el Rent to Own no
  tiene documentos para quien no necesita codeudor, y dos personas ya cayeron en esa categoría.

## Tarea (publicable)

**En una línea.** El registro de evidencia de un documento firmado guarda la fila de configuración de
la rama equivocada cuando la entidad tiene documentos definidos para los dos casos.

**Por qué.** La evidencia dice de qué configuración salió cada documento firmado. Hoy, para los
documentos que existen tanto con codeudor como sin él, apunta a la otra. El documento que recibe el
cliente es el correcto; lo que queda mal es el registro.

**Qué cambia.** El registro pasa a guardar la fila que corresponde a la situación real de la solicitud.

**Alcance.** Sólo entidades con documentos configurados para los dos casos. No cambia qué documentos se
generan, ni cómo se firman, ni lo que ve el cliente.

**Dónde probar.** Local o staging, con una entidad que tenga documentos configurados para los dos casos.

**Cómo validar.** Firmar una solicitud cuya política exija codeudor y comprobar que el registro de cada
documento apunta a la configuración de ese caso, no a la del otro.

**Criterios de aceptación.** Con codeudor, todos los registros apuntan a la configuración con codeudor.
Sin codeudor, a la de sin codeudor. Una entidad sin documentos configurados sigue comportándose igual
que hoy.

**Dependencias.** Ninguna.
