---
id: 51
title: "El contador de TusDatos está en el lugar equivocado — y duplicado en los dos monolitos"
stage: evaluation
created: "2026-08-18T19:30:00-05:00"
context_nodes: [kyc]
jira: []
jira_title: "Originación: reubicar el límite de consultas a la central registral y separarlo de la decisión de rechazo"
---

**ESTADO 2026-08-18 · ANALIZADO Y MEDIDO, sin tocar código.** La hipótesis de Miguel —«el límite de
intentos debería estar en un `else` de TusDatos y no en cada buró»— es **correcta**, y el problema es
más grande de lo planteado. Las mediciones dicen además que el cambio es **de bajo riesgo**, porque
el mecanismo hoy casi no actúa.

## Qué hace hoy

`OnboardingService::shouldValidateTusDatos($user->id)` lee dos `settings`, incrementa un contador en
caché y devuelve si se consulta o no a TusDatos. Se llama desde **dos** lugares: la rama de Ágil que
resolvió con el nombre mal (`:370`) y la de Mareigua en el mismo caso (`:413`). Cuando devuelve
`false`, la solicitud se **rechaza** con `ONB005`.

## Los tres problemas, en orden de peso

**1 · Vigila el 13% del tráfico que dice limitar.** A TusDatos se llega por cinco caminos y el
contador está en dos. Los otros tres —Ágil inconcluyente → Mareigua inconcluyente (`:430`), Mareigua
lanzando excepción (`:437`)— pasan directo.

Medido en prod sobre `kyc_name_checks`, 6.263 consultas a TusDatos:

| | |
|---|---|
| llegaron **sin** mismatch previo (sin contador) | **5.424 · 86,6%** |
| llegaron **con** mismatch previo (con contador) | 839 · 13,4% |

**2 · Un mismo número decide dos cosas de naturaleza distinta**: cuántas veces se le paga al
proveedor, y si a esta persona se le aprueba el crédito. Subir `max_attempts` para ahorrar consultas
cambiaría a quién se rechaza — un efecto que nadie esperaría de una perilla de costos. Esa fusión es
también por qué los logs estaban escritos al revés: quien los redactó no tenía claro cuál de las dos
cosas estaba leyendo.

**3 · Como límite de gasto, casi no actúa.** Medido en Loki (prod, expresión métrica, no muestra):

```
ONB005 en 24h  ....................................  48
  · «TusDatos errors, returning ONB005»  ...........  42
  · «AgilData errors and no TusDatos retry»  .......   0
  · «Mareigua errors and no TusDatos retry»  .......   0
«no TusDatos retry» en 7 DÍAS  .....................   1
```

O sea: **frena a una persona por semana**, contra ~42 por día que rechaza el veredicto propio de
TusDatos. Reordenarlo no le cambia el desenlace prácticamente a nadie — por eso es barato hacerlo
bien.

## ⚠ Está DUPLICADO, y lo que nos dijeron sobre eso es falso

Se dijo que `legacy-application/app/Http/Controllers/Customer/PersonalInfoController.php` ya no se
usa. **No es cierto**, medido el 2026-08-18:

- el controller sigue **ruteado** (`routes/customer.php:132-136`) y lo tocó **Joel el 2026-06-30**
  (`1b1d1661`, fix de CORE-148);
- `legacy-application` empuja **9.454 líneas/día** a Loki en producción;
- y su `PersonalInfoController` **está corriendo hoy**: aparecen
  `PersonalInfoController::alliedsLendersValidator: not triggered` y
  `Experian disparado desde storePersonalInfo (consultQuanto)` con marcas de hoy.

Y tiene **su propia copia del mismo mecanismo**: `shouldValidateTusDatos` en `:496`, con los mismos
dos llamadores (`:591`, `:614`) y **las mismas claves de `settings`**. O sea que la perilla es
compartida pero el código está duplicado: tocar uno solo deja los dos monolitos decidiendo distinto
sobre la misma configuración.

⚠ Ojo con medirlo por logs: **la cascada de `application` no loguea nada**. Un `0` en Loki buscando
frases del backend ahí no prueba ausencia — prueba que esa frase no existe en ese código. Me pasó y
casi concluyo lo contrario.

## ⚠ LO MÁS GRAVE, y no lo estábamos buscando: en `application` el veto de TusDatos NO EXISTE

Salió de pasarle el flujo a un agente de Gemini (`make agente-lector` con los cinco archivos), y está
**verificado a mano contra `main`**. `PersonalInfoController.php:628-652`:

```php
$tusDatosApplied = false;
try {
    $dataTD = $tusDatosController->validateUserDataTusDatosV2($request, $user);
    if (!($dataTD['error'])) { …aplica los datos…; $tusDatosApplied = true; }   // sólo el ÉXITO
} catch (\Exception $exception) { }
if (!$tusDatosApplied) {                       // cualquier error cae acá
    $user->first_name = Str::upper($request->name);
    $user->surname = Str::upper($request->surname);
    …
}
$user->save();
```

**No hay rama para `errors`.** TusDatos diciendo «Segundo apellido no coincide» no rechaza: se
descarta el veredicto y se guarda **lo que tecleó el asesor**. Después del `save()` sólo se crea la
solicitud; no queda ninguna otra validación de identidad (verificado hasta `:672`).

Es el mismo daño de CORE-420 pero **total**: allá el `0 == null` se tragaba un código puntual, acá se
tira el veredicto entero.

### Y encadenado con el contador invertido, se puede pasar reintentando

Con `max_attempts = 2`, para un cliente cuyo nombre no coincide en Ágil o Mareigua:

| intento | contador de `application` | qué pasa |
|---|---|---|
| 1º | no hay clave → pone 1 → `false` | **rechaza** |
| 2º | `1 < 2` → pone 2 → `false` | **rechaza** |
| 3º | `2 >= 2` → **`true`** | consulta TusDatos → **y pase lo que pase, guarda lo tecleado** |

O sea: **insistir tres veces alcanza para entrar con cualquier nombre.** ⚠ Esto es lectura de código,
no reproducido corriendo — `application` no está en el stack local. Antes de moverlo, reprodúzcase.

## Lo que aportó el agente, y qué se hizo con cada cosa

Se le pasaron los cinco archivos del flujo y se le pidió que no asumiera que el código es correcto.

| lo que dijo | estado |
|---|---|
| la inversión de `shouldValidateTusDatos` entre los dos monolitos | **confirma** lo que ya habíamos encontrado, por lectura independiente |
| el contador no interviene en los caminos inconcluyente/excepción | **confirma** la medición del 86,6% |
| `application` descarta el veto de TusDatos | **NUEVO · verificado a mano** (arriba) |
| `getGender($dataTD['names'])` en el `catch` de TusDatos (`OnboardingService:535`), con `$dataTD` posiblemente indefinido | **verificado que existe.** `getGender(null)` lanzaría `TypeError`, que extiende `Error` y **no** lo atrapa el `catch (\Exception)` — misma familia que el `ValueError` de la tarea 47 |
| Ágil `98`/`99` y Mareigua `16` tratados como «sin datos» en vez de reintentables | **corrobora** lo que la tarea 47 ya tenía escrito |
| mensaje de error de Mareigua en el `catch` de Ágil, en `application` | sin verificar |
| `code => 400` en aciertos de caché | sin verificar |
| `users.age` del buró contra `date_of_birth` sintética | sin verificar |

## Lo que propongo

Separar en dos lo que hoy está fundido:

- **un guard de llamada** inmediatamente antes de consultar TusDatos, que cubra los cinco caminos —
  ése sí limita gasto;
- **la decisión de rechazo, explícita**: «la central anterior dijo que el nombre no cuadra y no queda
  a quién preguntarle → `ONB005`». Hoy eso ocurre por efecto colateral de que el contador devolvió
  `false`.

Y decidir qué se hace con la copia de `application`: arreglar las dos, o cerrar primero ese camino.

## Preguntas abiertas

- ¿El contador es por `user_id`, así que empezar el wizard con otro teléfono lo reinicia? Si es así,
  como límite de gasto es trivial de saltar. **No verificado.**
- ¿Qué fracción de las solicitudes de originación entra hoy por `application` y cuál por el wizard?
  Es lo que decide si hay que arreglar en dos lados o se puede esperar al cutover.
- `personal_info_validation_error_cache_duration` **no existe como fila** en prod: cae al default del
  código, 5 minutos. ¿Es deliberado?
