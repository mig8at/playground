---
id: 73
title: "Cargar en producción el catálogo de ciudades de RD y Perú"
stage: work
created: "2026-09-04T09:00:00-05:00"
knowledge: [country-geography]
canon: [comercio, onboarding, arquitectura]
jira: [CORE-516]
jira_title: "Cargar en producción el catálogo de ciudades de RD y Perú"
ramas: "fix/sucursales-rd-apuntan-a-ciudades-de-colombia"
---

## Lectura técnica vigente · 2026-10-03

La relación país → zona → ciudad y la reconstrucción del catálogo están en
`country-geography`. La migración de septiembre ya existe en la ref local de `main` del backend.
Siembra RD y Perú; su reparación examina referencias rotas o de otro país en comercios no
colombianos, usando sólo un comodín del país correspondiente cuando existe. `down()` no revierte.

Las cifras y los usos de filas de abajo son mediciones de septiembre conservadas con su fecha,
no una lectura actual de producción. Para retomar, identificar el ambiente, contar por el join
geográfico y verificar ciudad contra país del comercio. En un formulario dinámico también hay
que comprobar el árbol servido por form-service: cambiar tablas no sustituye su copia de Redis/S3.
La presencia de la migración en `main` no acredita su ejecución ni la alineación de otras ramas.


# Cargar en producción el catálogo de ciudades de RD y Perú

## Lo que se resolvió, con su medición

> **MEDICIÓN · 2026-09-04 (prod, después del lote 203)** — comparada con lo que había antes:
>
> | | antes | ahora |
> |---|---|---|
> | ciudades de Rep. Dominicana | 8 | **159** |
> | ciudades de Perú | 0 | **1.875** |
> | sucursales con la ciudad en otro país | 20 | **0** |
>
> *Cómo se vuelve a comprobar:* contar `country_cities` por país uniendo por `country_zones`, y cruzar
> el país del comercio contra el país de la ciudad de su sucursal.

## Lo que quedó abierto y NO es esta tarea

Al validar lo anterior aparecieron filas centinela y una corrupción, que son otro trabajo:

- **La zona `Medellín` de COMORAS.** Su código es `G`, o sea **Grande Comore**: alguien le pisó el
  nombre. De ella cuelga una ciudad llamada **`Extranjero`**. Las dos tienen **cero usos**.
- **La zona `Extranjero` de Colombia**, sin ninguna ciudad y sin usos.
- **Los comodines `TODAS LAS CIUDADES`** (uno por país, colgando de una zona `Todos los
  departamentos`). ⚠ **NO son basura: 95 sucursales los usan** —78 en Colombia y 17 en RD—, así que
  borrarlos rompe. Si deben existir es una decisión de producto; que vivan como una fila más de
  `country_cities`, mezclados con ciudades reales, es lo discutible.

## Cómo se comprueba

1. RD tiene 159 ciudades y Perú 1.875, en producción. ✅ 2026-09-04
2. Cero sucursales con el país de su ciudad distinto del de su comercio. ✅ 2026-09-04
3. `qa`, `develop` y `staging` contienen el commit `ab89d273`. ⏳ pendiente
## Tarea (publicable)


## En una línea

✅ **Hecho el 2026-09-04.** Se cargó en producción el catálogo de ciudades de República Dominicana y
Perú, y se corrigieron los puntos de venta que apuntaban a una ciudad de otro país. Queda un paso
técnico: alinear las ramas de los ambientes de prueba.

## Por qué

Hoy en producción los 16 comercios dominicanos tienen sus 20 puntos de venta apuntando a una ciudad
**de Colombia**: existe un Santo Domingo en Antioquia, así que la pantalla mostraba un nombre correcto
y guardaba el país equivocado. Y 30 de las 32 provincias del país no tienen ninguna ciudad para
elegir, así que ni siquiera había a dónde corregirlos.

Perú está peor: tiene sus departamentos pero ninguna ciudad, y el paso de datos personales pide una.
Eso significa que hoy **no se puede completar una solicitud en Perú**.

## Qué cambia

- República Dominicana pasa de 8 municipios a los 158 del país.
- Perú pasa de ninguna ciudad a sus 1.874 distritos.
- Los 20 puntos de venta dominicanos quedan apuntando a una ciudad de su propio país.

Los datos salen de las fuentes oficiales de cada país: la división territorial de la Oficina Nacional
de Estadística para República Dominicana y el UBIGEO del Instituto Nacional de Estadística para Perú.

## Alcance

No entra ningún otro país. Los demás donde la plataforma podría operar siguen sin ciudades, y no
bloquean nada porque todavía no tienen comercios. Tampoco se toca el selector de ciudad, que ya se
corrigió aparte.

## Dónde probar

En **producción**, donde ya está aplicado. El ambiente compartido de pruebas también tiene los datos.

## Cómo validar

1. En el panel de administración, abrir un punto de venta de un comercio dominicano y ver que su
   ciudad es dominicana y no colombiana.
2. Abrir el desplegable de ciudad de ese punto de venta y comprobar que ofrece municipios de todas las
   provincias, no sólo los ocho del área metropolitana de Santo Domingo.
3. Repetir con un comercio peruano: el desplegable tiene que ofrecer distritos.

## Criterios de aceptación

- ✅ Ningún punto de venta queda con la ciudad en un país distinto al de su comercio. *(verificado en
  producción el 2026-09-04: eran 20, ahora son 0)*
- ✅ El selector de ciudad ofrece municipios en las 32 provincias dominicanas. *(de 8 ciudades a 159)*
- ✅ El selector ofrece distritos en los 25 departamentos peruanos. *(de 0 a 1.875)*
- ⏳ Una solicitud en Perú puede pasar el paso de datos personales. *(pendiente de probarlo corriendo)*
- ⏳ Los ambientes de prueba quedan con el mismo código, no sólo con los mismos datos.

## Dependencias / contraparte

Ninguna externa. Sí hace falta coordinar con quien tenga permiso para ejecutar migraciones en
producción, y que el cambio de ciudad de los 20 puntos de venta se haga con alguien mirando: son
comercios que están operando.
