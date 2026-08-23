---
id: 65
title: "Credifamilia (rt=4) cierra entero en local — y el paralelo destapó un deadlock latente"
stage: work
created: "2026-08-23T15:00:00-05:00"
context_nodes: [credifamilia, findings]
jira: []
jira_title: "Firma de documentos: sacar las llamadas a proveedores de adentro de la transacción"
---

**ESTADO 2026-08-23.** Credifamilia **cierra de punta a punta en local**, hasta estado 11 con siete
documentos firmados. Era la única de las cinco familias de `response_type` sin constancia de cerrar.
Salieron **cuatro hallazgos** del sistema: F-163, F-164, F-165 y —el que importa— **F-166**.

## Por qué costó: seis externos en fila, y ninguno se anuncia

El negocio nunca fue el problema. Lo fue la cadena de dependencias fuera del backend: **seis**, cada
una tapando a la siguiente, y **ninguno de los seis mensajes de error nombra lo que falta**. El detalle
con la tabla de los seis muros está en **F-165**; la receta para repetirlo, en el nodo `credifamilia`.

Los dos que no existían y hubo que construir:

- **`mock-deceval` (:8106)** — el pagaré desmaterializado. Cuatro operaciones SOAP con **cuatro
  contenedores distintos y tres criterios de éxito** (F-164). La cuarta, `firmarPagares`, **ignora el
  nodo `exitoso`** y pide que `descripcion` empiece con `SDL.SE.0000`.
- **`mock-netco` (:8107)** — la firma electrónica. Seis endpoints; la trampa es que el login **exige la
  cabecera `Set-Cookie`**: un 200 con el cuerpo perfecto y sin ella falla con un mensaje de sesión.

Y un dato malo que costó tiempo: la credencial de Deceval del **dump local** trae claves de **Experian**
(F-163). No es un bug de producción — allá las filas son otras, y se verificó.

## Lo que apareció al correrlo en PARALELO, que es lo que vale de esta tarea

La suite de tres casos cierra **3/3 en serie** y **1/3 en paralelo**. Los dos que fallan devuelven
`HTTP 500 · There is no active transaction`, que suena a bug del framework. **No lo es**, y la causa
está a tres capas de profundidad (**F-166**):

1. La autorización abre `DB::beginTransaction()` y **firma los seis documentos adentro** — o sea que
   sostiene locks de fila durante **doce viajes de red** (Netco + S3, por documento).
2. Dos autorizaciones simultáneas se traban: `1213 Deadlock`. Pero el `catch` que lo atrapa se llama
   `$s3Error` y su `try` **también envuelve el `update`**, así que el deadlock se registra —y se
   **guarda en la base**— como `S3_FAILED:`.
3. La recuperación de ese `catch` **repite el `update` que acaba de fallar**, y el `rollBack()` de
   arriba encuentra una transacción que MySQL ya revirtió → `There is no active transaction`, que
   **reemplaza** a la excepción original.

**Hoy no pasa en producción y se midió antes de decirlo:** cero `Deadlock` en 24 h (control: `Exception`
= 120 en la misma ventana), cero solicitudes trabadas en 28, 296 de 550 en estado 11 en 90 días. Lo que
lo tapa es el **volumen** —unas 6 solicitudes de Credifamilia por día—, no el diseño. Es latente.

## Qué quedó en el repo

- `harness/mock-deceval/` + `harness/mock-netco/`, los dos con launcher (`bin/mock-*`), modo de fallo
  (`MOCK_*_FAIL=1`) y el porqué escrito adentro.
- `harness/suites/credifamilia.json` — tres casos declarativos. **Corrérla en serie**: con `PAR=1`
  reproduce F-166, que es útil pero no es una regresión.
- El **prevuelo** de `dev/caso.ts` ahora avisa si Deceval o Netco están caídos cuando el caso va a
  cerrar, en vez de dejar que el síntoma parezca del negocio.
- Cuatro correcciones del propio runner, todas del mismo tipo: **decía cosas que no había probado**.
  - La consulta del asesor usaba un campo inexistente (`br.b`) y **dejaba la solicitud sin asesor**
    —el modo de F-46—, tapado por un `.catch` vacío.
  - `porDefecto` de las suites sólo alimentaba tres campos numéricos; declarar el comercio una vez
    arriba fallaba con «falta comercio», que suena a suite mal escrita.
  - **El plazo pedido no llegaba.** `@cuotas=36` viajaba en la selección de entidad y después el
    confirm del plan lo **pisaba con `cycles[0] ?? 4`**. Medido: pedir 12, 24 o 36 dejaba
    `fee_number = 4` en los tres, y el caso daba verde igual.
  - **Y los plazos ofrecidos nunca se leyeron**: el runner buscaba `cycles` y `simulations`, y la clave
    es **`paymentSchedule`**. Al caer al sobre entero creía que la entidad no ofrecía ninguno. Ahora
    elige el ciclo que se pidió y, si no está, lo **dice** en vez de cerrar con otro en silencio.

## Y de ahí salió F-167, que es del producto

Arreglando lo anterior apareció que **el plazo lo dicta el cliente**. Con la entidad simulando 6, 12,
18 y 24, se confirmó con **36** y la solicitud cerró en estado 11 con ese plazo guardado: el campo que
el controlador usa no tiene ninguna regla de validación, y el que sí se valida sólo exige `min:1`. El
número de cuotas define la cuota, el plan de pagos y lo que dice el pagaré. **No está probado que haya
pasado en producción** —la cola de plazos raros son diez filas en 180 días y no se sabe qué ofrecía el
catálogo entonces—, así que queda como pregunta abierta.

## El ciclo COMPLETO: estado 11 **y** radicación

Lo que faltaba después del estado 11 era la **radicación** —mandarle a Credifamilia el paquete de
documentos—, y ya corre: la suite cierra 3/3 en `CREDIT_COMPLETED`. Hicieron falta tres cosas:

- **Las dos fotos de la cédula** (`users.front_url` / `users.back_url`), que las deja la validación de
  identidad y el camino sintético saltea. De los nueve documentos que exige la formalización, siete los
  produce el flujo y estos dos no.
- **El catálogo de estados de la transacción**, sin sembrar en local. Su ausencia **tapa la causa real**:
  al intentar registrar el error se tira otra excepción encima.
- **El SOAP de radicación** — dos operaciones, mock nuevo en `:8108`.

### ⚠ Y de acá salió F-168, que es lo más importante de este tramo

**«Autorizada» no es «radicada», y nada lo distingue afuera de una tabla.** La radicación es posterior
al estado 11 y **no lo mueve**: si falla, la solicitud queda igual en 11, el endpoint devuelve **200** y
el runner dice «cerró». Sólo `lender_transactions` lo sabe.

Se descubrió porque el backend local salía al **sandbox real del lender**, que da 504 — o sea que
además, hasta hoy, **cada corrida mandaba una solicitud sintética al ambiente de pruebas de
Credifamilia**.

El runner ahora **lee y reporta** ese estado en cada cierre, y las suites pueden exigirlo. Está
comprobado que la guarda atrapa: con el mock en modo rechazo, las tres corridas llegan a estado 11 y la
suite **falla**.

## Lo que NO prueba

Ni el pagaré ni la firma son reales. Un pagaré desmaterializado vale justamente **porque** no se puede
simular, y el «PDF firmado» que devuelve el mock de Netco es idéntico al que entró. Un verde acá
significa «la orquestación corre», nunca «el documento tiene validez».

## Bitácora

- **2026-08-23** — de «no lista» a estado 11. Seis muros, cuatro hallazgos, dos mocks nuevos.

## Tarea (publicable)

**En una línea.** La firma de documentos llama a dos proveedores externos por cada documento **desde
adentro de una transacción de base de datos abierta**, y cuando dos clientes autorizan a la vez se
traban entre sí.

**Por qué.** Mantener la transacción abierta durante doce llamadas de red sostiene bloqueos mucho más
tiempo del necesario. Al trabarse, el error que llega al cliente no menciona la causa: el registro
queda etiquetado como una falla de almacenamiento y el mensaje final habla de transacciones. Un
diagnóstico posterior arranca con dos pistas falsas.

**Qué cambia.** Las llamadas a proveedores salen de la transacción; la transacción se acota a la
escritura final. El manejo de errores deja de atribuir a almacenamiento lo que es de base de datos, y
no reintenta dentro del mismo bloque la operación que acaba de fallar.

**Alcance.** El camino de firma de documentos. No cambia qué documentos se generan, ni su contenido, ni
el resultado para un cliente que autoriza solo.

**Dónde probar.** Local o staging.

**Cómo validar.** Autorizar dos solicitudes de la misma entidad simultáneamente y comprobar que las dos
llegan a autorizada. Antes del cambio, una de las dos falla.

**Criterios de aceptación.** Dos autorizaciones simultáneas terminan bien. Si alguna falla por otra
causa, el mensaje registrado nombra esa causa y no una falla de almacenamiento.

**Dependencias.** Ninguna.
