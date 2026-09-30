# Clientes de prueba de Credifamilia

Lista que entregó Credifamilia (Excel «Pruebas credifamilia sin validación de identidad ni firma con Deceval»): 6 personas que su QA debería **aprobar** y 6 que debería **negar**. Sirve para repetir la prueba de la radicación sin inventar cédulas. Los datos están en `harness/lender/credifamilia-usuarios-de-prueba.json`; el Excel trae además, por persona, el enlace de una solicitud vieja de staging (`originaciones-stg`), que no se copió porque apunta a solicitudes ya cerradas.

## Aprobados

| cédula | nombre | nacimiento | ocupación | celular | OTP inicial |
|---|---|---|---|---|---|
| 79799966 | EDUARD RAIRAN | 1994-10-31 | Empleado | 3108000001 | 0001 |
| 15348200 | JUAN CANO | 1985-01-31 | Empleado | 3108000002 | 0002 |
| 1090381858 | XIMENA BLANCO | 2005-06-22 | Empleado | 3108000003 | 0003 |
| 27250362 | MARIA PERENGUEZ | 1996-12-14 | Empleado | 3108000004 | 0004 |
| 71713842 | CARRERA DE LA | 1988-05-26 | Empleado | 3108000005 | 0005 |
| 37670195 | ROSA HERNANDEZ | 1999-12-14 | Empleado | 3108000006 | 0006 |

## Negados

| cédula | nombre | nacimiento | ocupación | celular | OTP inicial |
|---|---|---|---|---|---|
| 1129572728 | HENRY MISAS | 2004-12-20 | Empleado | 3109000001 | 0001 |
| 1144187830 | ANDRES MOSQUERA | 2013-02-08 | Independiente | 3109000002 | 0002 |
| 1022370286 | JESSICA BANOS | 2009-08-28 | Empleado | 3109000003 | 0003 |
| 80761796 | JUAN MARTINEZ | 2001-07-23 | Empleado | 3109000004 | 0004 |
| 12229740 | EDUARDO PINO | 1982-06-10 | Independiente | 3109000005 | 0005 |
| 15437078 | ERNESTO PAREJA | 1992-12-28 | Empleado | 3109000006 | 0006 |

El OTP de firma del Excel es `00000N` para el aprobado N (`000001`…`000006`); los negados no firman.

## Cómo usarlos con el harness

El caso recibe `cliente=<cédula>` y usa su cédula, nombre, fecha de nacimiento, correo y celular en vez de los del cliente sintético. El OTP que usa el harness son los últimos 4 dígitos del celular, que coinciden con el «OTP inicial» de la lista.

```sh
E2E_TARGET=dev I_KNOW_THIS_TOUCHES_SHARED_DEV=1 make harness-case CASES='#82e8961e:24@cliente=15348200' CLOSE=1 LAMBDA=1 TARGET=dev
```

## Qué se comprobó contra dev (2026-09-30)

- **No sirven para llegar a un «aprobado»:** los dos aprobados que se podían registrar (15348200 y 37670195) recibieron del sandbox `rejected` con «Fallo en el análisis - Listas restrictivas: Error en la consulta», el mismo mensaje que el cliente sintético. Por eso la causa no es la cédula: parece un fallo del análisis de listas del QA de Credifamilia (por confirmar con ellos).
- **Ya existen en la BD de dev** (de pruebas de mayo y junio): 79799966, 27250362, 71713842 y 1090381858. Registrarlos de nuevo falla con `ONB005 DOCUMENT_DUPLICATE`; habría que reusar el usuario existente.
- **Un negado (80761796)** no llegó al análisis: el alta salió con ocupación «Desempleado», que Credifamilia no acepta (`does not support occupation type`). La ocupación sale del buró, no del Excel.
- Ninguno llegó a dar tasa ni tipo de fianza, así que la fórmula nueva del monto total no se puede ver de punta a punta en dev con estos datos.

## Pendiente

Preguntar a Credifamilia si el error de listas restrictivas es de su servicio en el QA, o si para estos clientes hace falta otra configuración (el Excel dice «sin validación de identidad ni firma con Deceval», y nuestro flujo sí las tiene).
