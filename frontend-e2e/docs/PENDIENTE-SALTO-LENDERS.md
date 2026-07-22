# Pendiente: el salto headless a `/lenders` rebota en staging

Estado al 2026-07-22. Todo lo demás de esta tanda quedó andando y commiteado; esto es lo único abierto.

## El síntoma

Con **"Saltar a: Lenders"** contra `staging`, el wizard queda en `/merchant/<hash>/solicitar` (monto) en
vez de abrir el listado. En `local` el mismo salto **sí** funciona.

```
1. goto → /merchant/76db47f5/464364/lenders
2. 302  → /login?redirectTo=%2Fmerchant%2F76db47f5%2F464364%2Flenders
3. 302  → auth.merchant.creditop.com   (login real)
4. 302  /merchant → /merchant/76db47f5/solicitar     ← el redirectTo se PIERDE
5. el harness reintenta el goto a /lenders → rebota otra vez a /solicitar
```

## Lo que ya está descartado

- **No es el estado de la solicitud.** Se sembraba en `1 «Validación OTP»` y el front la mandaba a `/otp`;
  ya se corrigió a **9 «Formulario de perfil»** (`dev/guided.spec.ts`, el INSERT del seed), que es el
  estado en el que está una solicitud sana cuando el wizard está en `/lenders`. Con eso **local anda**.
- **No es la firma del flujo.** Firma bien (`URV13000`) y el veredicto sale `✓ la omisión se aplicó`.
- **No crea una segunda solicitud.** El rebote ocurre antes de que el usuario toque nada.

## Las dos hipótesis vivas

1. **El `redirectTo` no sobrevive el callback de Cognito.** Después del login la app va a `/merchant`,
   que redirige a `/solicitar`. En local no se notaba porque la sesión estaba **cacheada**
   (`.auth/cognito-state.local.json`): el primer `goto` iba directo a `/lenders`, sin round-trip.
2. **El front de staging no es el mismo código.** Local corre el `:5174` de la rama de la tarea; staging
   es un **build desplegado desde `origin/staging`**. El guard de `/lenders` puede exigir algo que una
   solicitud sembrada directo en BD no tiene (p. ej. estado de sesión del wizard).

La (2) es la más probable, porque el harness **sí** reintenta el `goto` después del login (ver el bloque
`if (needsCognito())` en `dev/guided.spec.ts`) y aun así rebota.

## Por dónde seguir

- Leer el loader de `/lenders` en el build de staging (rama `origin/staging` del frontend-monorepo) y ver
  qué valida además del estado. Eso decide entre (1) y (2).
- Probar el salto en staging **con la sesión de Cognito ya cacheada** (`.auth/cognito-state.staging.json`
  vigente): si así funciona, la causa es la (1) y el arreglo es del front, no del harness.
- **Afinar el aviso**: hoy dice "el front rebotó la solicitud sembrada — su estado no pasa el guard",
  que asume la (2). Debería distinguir "se perdió el redirectTo" de "el front rechaza esta solicitud".

## Mientras tanto

- **staging** → usá **"Saltar a: Monto"** y marcá el selector en pantalla. Ese camino está validado y da
  el veredicto correcto.
- **local** → el salto headless funciona; es el camino rápido.

## Contexto relacionado

- **F-65** — el seed registraba contra el backend local aunque el target fuera dev (ya arreglado).
- **F-58** — el rechazo de la firma viaja en HTTP 200; por eso el harness mira el `code` y no el status.
- El recorte a `response_type = 0` con `flow_id = 2` deja el marketplace **vacío** en comercios sin
  entidades rt=0 (Pullman en local). No es un bug: es la consecuencia de negocio a confirmar con producto.
