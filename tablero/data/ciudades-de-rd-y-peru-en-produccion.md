---
id: 73
title: "Cargar en producción el catálogo de ciudades de RD y Perú"
stage: work
created: "2026-09-04T09:00:00-05:00"
context_nodes: [merchants, onboarding, architecture]
jira: [CORE-516]
jira_title: "Cargar en producción el catálogo de ciudades de RD y Perú"
ramas: "fix/sucursales-rd-apuntan-a-ciudades-de-colombia"
---

# Cargar en producción el catálogo de ciudades de RD y Perú

## Si retomás esto sin contexto, empezá acá

**El trabajo está HECHO y mergeado. Lo que falta es correrlo en producción.** No hay que escribir
código: hay que ejecutar una migración que ya existe, ya está revisada y ya corrió en la base
compartida sin problemas.

El PR **legacy-backend #1301** («El catálogo de ciudades de RD y Perú, y las sucursales dejan de
apuntar a otro país») mergeó a `main` el **2026-09-03 22:11** y salió a producción con el tag
**v0.5.2** el mismo día. Pero **mergear no corre migraciones** (F-77), así que el código está
desplegado y los datos no.

**El próximo paso es:** correr esa migración contra producción con el workflow manual
`Run Database Migrations`, y verificar después los tres números de §«Cómo se comprueba».

## Qué está mal hoy en producción

> **MEDICIÓN · 2026-09-04 (prod, solo lectura)** — comparada con la base compartida, que ya tiene el
> catálogo cargado:
>
> | | producción | compartida (dev/qa/staging) |
> |---|---|---|
> | ciudades de Colombia | 1.123 | 1.123 |
> | **ciudades de Rep. Dominicana** | **8** | **159** |
> | **ciudades de Perú** | **0** | **1.875** |
>
> *Cómo se vuelve a comprobar:* contar `country_cities` uniendo por `country_zones.country_id`.

Tres consecuencias concretas, las tres visibles para alguien de afuera:

1. **Las 20 sucursales de comercios dominicanos apuntan a una ciudad de COLOMBIA** — 17 a Santo
   Domingo de Antioquia y 3 al comodín «todas las ciudades». El homónimo es lo que lo volvió
   invisible: el selector mostraba un nombre correcto y guardaba el país equivocado.
2. **30 de las 32 provincias dominicanas no tienen ni una ciudad.** Hay una sucursal cuya dirección
   dice «la otra banda de higuey» y Higüey ni siquiera existe como fila.
3. **Perú no puede completar una solicitud.** Tiene sus 25 departamentos y cero ciudades, así que el
   paso de datos personales pide una ciudad que no se puede elegir y el flujo se corta ahí.

⚠ **Y las zonas NO son el problema**: los 18 países operativos ya tienen sus departamentos cargados
(entre 7 y 36). Lo que falta es el nivel de abajo.

## Dónde se toca

Nada de código. Una sola migración, ya en `main`:
`2026_09_03_120000_ciudades_de_rd_y_peru_y_sucursales_en_pais_equivocado`.

Carga 158 municipios de RD y 1.874 distritos de Perú, y reubica las sucursales mal apuntadas. Las
fuentes son las oficiales de cada país —la división territorial 2021 de la ONE para RD y el UBIGEO del
INEI para Perú— y quedan citadas en el docblock de la propia migración.

## Cómo se ataca

1. Correr la migración en **producción** con el workflow manual `Run Database Migrations` de
   `legacy-backend`. Es el mismo camino por el que se corrieron los lotes 197 a 202.
2. Verificar los tres números de abajo.
3. Bajar el código a `qa`, `develop` y `staging` (ver el bloqueo).

## Lo que está bloqueado

> **BLOQUEANTE · 2026-09-04** — el commit `ab89d273` está **sólo en `main`**: `qa`, `develop` y
> `staging` no lo tienen. La base compartida SÍ tiene los datos, porque alguien corrió la migración
> desde su máquina. O sea que en esos tres ambientes **el dato existe y el código que lo produce no**,
> y una base que se recree desde cero volvería a quedar sin ciudades. Hay que bajar `main` a esas
> ramas, o portar el commit.

## Riesgos

> **RIESGO · 2026-09-04** — la migración **reubica sucursales en producción**: cambia
> `allied_branches.country_city_id` de 20 puntos de venta activos. Es lo que hay que hacer, pero es
> una escritura sobre datos vivos de comercios que están operando. Conviene correrla con alguien
> mirando y saber de antemano a qué ciudad queda cada una.

> **RIESGO · 2026-09-04** — el `down()` no puede deshacer la reubicación: no guarda a qué ciudad
> apuntaba cada sucursal antes. Si hay que volver atrás, es a mano.

## Lo que NO entra

- **Los otros 15 países operativos** (México, Brasil, Argentina, …) siguen con cero ciudades. No
  bloquean nada porque no tienen ni un comercio; se cargan cuando se abra el país.
- Reescribir el selector de ciudad. Ya se hizo aparte: distingue homónimos y filtra por departamento.

## Cómo se comprueba

Contra producción, después de correr la migración:

1. **Rep. Dominicana pasa de 8 a 158 ciudades** y ninguna de sus 32 provincias queda vacía.
2. **Perú pasa de 0 a 1.874 distritos**, repartidos en sus 25 departamentos.
3. **Cero sucursales con el país de su ciudad distinto del país de su comercio** — hoy son 20.

Y en pantalla: abrir el punto de venta de un comercio dominicano en el admin y ver que su ciudad ya
es dominicana.

## Registro

### 2026-09-04 · publicada como CORE-516, en el sprint 14

### 2026-09-04 · la tarea nace ya resuelta en código: lo que falta es correrla

Al levantar la tarea de «agregar las ciudades que faltan» se midió primero, y el trabajo ya estaba
hecho: PR #1301, mergeado a `main` el 3/9 y desplegado con `v0.5.2`. Lo que no ocurrió fue la
migración.

También salió que la base compartida ya tiene el catálogo (159 ciudades de RD, 1.875 de Perú) pero el
commit **no está en `qa`/`develop`/`staging`**: se corrió desde una máquina local. Eso queda como
bloqueante aparte, porque es la clase de desfase que se descubre tarde.


## Tarea (publicable)

## En una línea

Cargar en producción el catálogo de ciudades de República Dominicana y Perú, y corregir los puntos de
venta que hoy apuntan a una ciudad de otro país.

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

En **producción**, que es el único ambiente al que le falta. El ambiente compartido de pruebas ya
tiene los datos cargados.

## Cómo validar

1. En el panel de administración, abrir un punto de venta de un comercio dominicano y ver que su
   ciudad es dominicana y no colombiana.
2. Abrir el desplegable de ciudad de ese punto de venta y comprobar que ofrece municipios de todas las
   provincias, no sólo los ocho del área metropolitana de Santo Domingo.
3. Repetir con un comercio peruano: el desplegable tiene que ofrecer distritos.

## Criterios de aceptación

- Ningún punto de venta queda con la ciudad en un país distinto al de su comercio.
- El selector de ciudad ofrece municipios en las 32 provincias dominicanas.
- El selector ofrece distritos en los 25 departamentos peruanos.
- Una solicitud en Perú puede pasar el paso de datos personales.

## Dependencias / contraparte

Ninguna externa. Sí hace falta coordinar con quien tenga permiso para ejecutar migraciones en
producción, y que el cambio de ciudad de los 20 puntos de venta se haga con alguien mirando: son
comercios que están operando.
