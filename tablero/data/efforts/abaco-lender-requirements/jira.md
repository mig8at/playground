---
title: "Renting: el requisito de validar ingresos con Ábaco pasa a ser configuración de la entidad, y se retiran los \"modos\" de comercio"
---

## En una línea
Que una entidad pida validación de ingresos con Ábaco ahora es un dato de configuración de esa entidad, y desaparece el mecanismo de "modos" que solo existía para un comercio.

## Por qué
Los "modos" eran un camino paralelo, exclusivo de un comercio, que decidía por código si el flujo pedía validación de ingresos con Ábaco. No se podía administrar, ninguna otra entidad lo usaba y obligaba a mantener un comportamiento distinto para un solo caso. Al pasarlo a configuración, cualquier entidad puede pedir Ábaco sin cambios de código.

## Qué cambia
- El requisito de validar ingresos con Ábaco se lee de la configuración de la entidad financiera.
- Se retira el concepto de "modo" del comercio en todo el flujo.
- Las personas **sin historia en centrales de riesgo** (por ejemplo, con documento PEP) pueden obtener cupo en las entidades que validan ingreso con Ábaco; antes quedaban sin cupo y no podían avanzar.

## Alcance
- Aplica al comercio de renting y a las entidades configuradas para validar ingresos con Ábaco.
- **No** cambia las entidades que no validan con Ábaco: siguen exigiendo historia en centrales de riesgo.
- Regresión: una persona **con** historia en centrales obtiene el mismo cupo que antes.
- Fallback: si la configuración no se puede leer, se exige central de riesgo — se comporta como hoy, no se abre cupo por error.

## Dónde probar
- Ambiente de pruebas · comercio de renting · marketplace de entidades.
- **Precondición:** comercio habilitado con la entidad de renting, y un usuario de prueba sin historia en centrales de riesgo (documento PEP).

## Cómo validar
1. Usuario **sin** historia en centrales → la entidad de renting aparece **con cupo** y el flujo permite continuar hasta la validación de ingresos.
2. Usuario **con** historia en centrales → obtiene el mismo cupo que antes (regresión).
3. Entidad que **no** valida con Ábaco + usuario sin historia → sigue **sin cupo** (no se abrió de más).

## Criterios de aceptación
- [ ] La entidad de renting ofrece cupo a un usuario sin historia en centrales y el flujo llega a la validación de ingresos.
- [ ] Las entidades que no validan con Ábaco no cambiaron su comportamiento.
- [ ] Ya no existe el concepto de "modo" de comercio en el flujo.

## Dependencias / contraparte
Requiere tres cosas antes de validar: la configuración de la entidad activada, la actualización de base de datos aplicada en el ambiente, y el cambio publicado en el ambiente que consulta el servicio de pre-aprobación de cupo. Si falta lo último, la tarjeta seguirá mostrando "sin cupo" aunque el cambio esté correcto.
