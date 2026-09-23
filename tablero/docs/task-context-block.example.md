# La guarda de la suite frena las tres formas de recrear la base

La guarda vive en [CreatesApplication](repo:legacy-backend/tests/CreatesApplication.php) y corre antes
de `setUpTraits()`, así que contiene el trait, el `uses()` de Pest y el `Pest.php` de una carpeta. La
identidad del cliente se decide aparte: [el tema de KYC](canon:kyc).

```harness
make harness-listado COMERCIO=<slug> TARGET=local
```
Resultado: acá va lo que dio la corrida, resumido — cuántas entidades salieron y cuáles no.

```sql prod
SELECT count(*) AS solicitudes FROM user_requests WHERE user_request_status_id = 11
```
Resultado: el número, y qué dice de la tarea.
