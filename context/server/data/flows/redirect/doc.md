# Redirect · contexto
> **estado:** al día con main · Familia de prestamistas por REDIRECCIÓN (rt=0, UTM/referido): CreditOp escribe la url_utm, redirige al sitio del lender y pierde visibilidad total.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Familia de prestamistas por **redirección** (`response_type` **0**, url_utm/referido). Es el contraste máximo con CreditopX: **nadie decide el crédito dentro de la plataforma**. CreditOp escribe una `url_utm`, redirige al sitio del lender, y a partir de ahí la decisión, el monto y el desenlace ocurren **afuera**. No es inyectable ni rastreable localmente.

## Contenido
- CreditOp solo escribe `lenders_by_allied_branches.url_utm` y manda al usuario a la web del lender.
- **No hay Estado 11 rastreable**: la plataforma no sabe si el crédito se dio — es un callejón sin salida para el seguimiento.
- Fiel al modelo del simulador: en la cadena post-selección, rt=0 tiene un único paso (`redirect: abre`) que solo "abre" el sitio y pierde el hilo; rt=2/3 en cambio corre local estado por estado hasta el 11, y rt=1 formaliza afuera pero al menos vuelve por webhook.

## Dónde mirar
- **url_utm por sucursal** (application): `lenders_by_allied_branches.url_utm` — override mínimo por sucursal (hereda del comercio por COALESCE); se escribe en `AlliedAlliedBranchController.php` update.
- **Ruteo del listado**: la `url_utm` gobierna el ruteo para rt=0/rt=1; para rt=2 se pisa con la ruta interna.
- **Tabla rt** y familia: playground/flow/MAP.md §0 (fila rt=0 "url_utm / redirect · Quién decide: Nadie").

## Gotchas / riesgos
- **Callejón sin salida para la plataforma**: sin visibilidad post-redirect, no se puede medir conversión ni cartera; el crédito "desaparece" del sistema.
- No confundir con rt=1 (agregador): rt=1 también decide afuera, pero radica vía API y el resultado vuelve por webhook; rt=0 ni siquiera eso.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (psel.redirect + LendersNode rt=0 + MAP.md §0/Apéndice A).

## Enlaces
- Padre: **Entities**. Simulador: playground/flow (nodo "Formalización" paso Redirección rt=0). Mapa: playground/flow/MAP.md §0, Apéndice A.
