# CreditOp — el problema y cómo lo resolvemos (resumen)

> **En una frase:** hoy CreditOp **se adapta a cada comercio** —cada caso está "cosido" dentro del código—;
> el objetivo es **un modelo único que se configura**, al que los comercios se adaptan.

## El problema

Cada comercio nuevo (Motai, Alta, …) se resuelve con condicionales quemados que viajan por todo el flujo. Eso produce cuatro dolores:

- **No escala.** Sumar un comercio obliga a tocar código en varios lugares (frontend y backend).
- **Reglas duplicadas.** Las reglas de riesgo se **copian en cada sucursal** (~37.000 copias, ~5% ya distinta del original) → nadie puede decir con qué reglas presta realmente una entidad.
- **Todo disperso.** Documentos, PEP, calculadora y "modo" quemados y repartidos entre frontend y backend — la fórmula financiera, incluso duplicada.
- **Producto y decisión mezclados.** Una sola bandera decide a la vez *qué se contrata* y *cómo se aprueba*.

> **Raíz:** no hay un estándar; hay un **traje a medida por comercio**.

## Cómo lo resolvemos

Un modelo unificado con **responsabilidades separadas**, en dos movimientos:

1. **Unificar.** Los productos (compra, renting, rent-to-own) son **entradas de catálogo**, no un `if`; documentos, cálculo y reglas pasan a ser **configuración**. → Sumar un comercio = agregar una fila.
2. **Separar responsabilidades.** El *producto* (qué se contrata) aparte del *underwriting/decisión* (cómo se aprueba); la política vive en **niveles con herencia** (base → producto → acuerdo): **se hereda, no se copia**; y el administrador decide con la recomendación del motor.

## Cómo se llega

- **Por etapas, sin reescribir** el sistema: **extendiendo los patrones que ya están bien hechos** (configuración por columna, catálogo de entidades) en vez de sumar más condicionales.
- **Ya prototipado y demostrado** en el simulador de onboarding (catálogo de productos, política por niveles, herencia con override borrable).

## El resultado

Comercio nuevo = **una fila** · **cero deriva** de reglas · producto y riesgo **desacoplados** · una aplicación **ordenada y que escala**.

---

*Detalle y evidencia (archivo:línea): [UNIFICACION-Y-RESPONSABILIDADES.md](./UNIFICACION-Y-RESPONSABILIDADES.md). Modelo de negocio: [CREDITOP.md](../CREDITOP.md).*
