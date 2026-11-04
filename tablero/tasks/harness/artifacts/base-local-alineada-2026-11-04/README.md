# Base local alineada con producción (2026-11-04)

Respaldo de lo que había en la base local antes de alinearla con producción, para poder volver atrás.

- `backup-lender-rules-local.json`: las reglas sin grupo de Credifamilia (24) y Materiales (216). En la 24 se
  copiaron los valores de producción (mismos ids 71 a 76); las de la 216 se apagaron (`status = 0`), porque
  Materiales en producción (214) no tiene reglas sin grupo.
- `backup-datacredito-rules-local.json`: la regla genérica de Datacrédito de la 24 y la 216 (ids 1 y 7347),
  que producción no tiene. Se borraron.
- `backup-173-cats.json` y `backup-173-rules.json`: la política de Rent to Own (173). Sus cuatro categorías se
  apagaron (`active = 0`) y se crearon las cinco de producción (la 193) con sus reglas: categorías 259 a 263,
  reglas 362 a 366.

Para volver atrás: restaurar los valores de las filas de los respaldos, borrar las filas nuevas de la 173 y volver
a encender sus categorías.
