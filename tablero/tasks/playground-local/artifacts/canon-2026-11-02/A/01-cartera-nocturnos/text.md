**El cierre nocturno causa deuda, factura el ciclo y aplica pagos retenidos; un pago también puede actualizar el estado al aplicarse en el acto.** No todos los cambios esperan a la madrugada: [[#paz-y-salvo-con-saldo-y-pagos-que-no-desbloquean]]. Si falta una corrida, queda pendiente el trabajo que corresponde a ese proceso.

Los comandos de cartera son del monolito viejo, y su planificador ya no los agenda: **los lanza en secuencia el worker de cartera de loan-servicing**, cada uno como una tarea de una sola corrida, a hora fija de Bogotá:

| paso | no antes de | depende de |
|---|---|---|
| pagos de pasarela no aplicados | 00:02 | — |
| condonación de colillas y regularización | 00:10 | — |
| causación diaria y corte | 00:30 | colillas |
| pagos retenidos | 03:30 | — |
| cupos rotativos | 04:00 | causación |
| beneficios del crédito (subsidio) | 04:15 | causación |
| recordatorios | 10:15 | causación, retenidos, rotativos y beneficios |

**Un paso con dependencias no corre si alguna no terminó limpia.** Para el worker sólo desbloquea un paso que terminó completo: uno que falló, que se saltó o que terminó con errores parciales deja sin lanzar a los que dependen de él, y ese salto se avisa como alerta. Los pasos sin dependencias corren aunque el anterior haya fallado. Así, una causación que no termina limpia deja sin rotativos, sin subsidio y sin recordatorios esa noche; un fallo de los pagos retenidos sólo frena los recordatorios.

Un paso nunca corre encima de otro y espera a su hora aunque el anterior haya terminado antes. Si el subsidio no terminó a las 06:00 de Bogotá, el worker lanza una alerta crítica. En modo sombra el worker recorre la cadena sin correr ningún comando de cartera.

El nuevo agenda a las 09:30 de Santo Domingo el recordatorio de la entidad dominicana, excluida del envío del viejo. Por eso la ausencia de un recordatorio debe interpretarse según la entidad y el emisor.

La reconciliación de pasarela del nuevo también aplica pagos, pero se corre a mano. El worker lanza cada noche la aplicación de pagos de pasarela pendientes del viejo. Activar ambos sin coordinarlos cambia qué pagos podrían aplicarse.
