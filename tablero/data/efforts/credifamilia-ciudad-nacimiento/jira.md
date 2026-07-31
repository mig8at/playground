---
title: "Credifamilia: agregar campo 'Ciudad de nacimiento' en cascada al formulario"
---

El formulario de Credifamilia pide el 'Departamento de nacimiento' pero no tiene su 'Ciudad de nacimiento' asociada — a diferencia de los datos de residencia, trabajo y expedición, que sí tienen el par departamento→ciudad.

Objetivo: agregar 'Ciudad de nacimiento' como selección dependiente del departamento de nacimiento — al elegir el departamento se cargan sus ciudades (misma cascada que los otros pares).

Implementación: migración de datos sobre el formulario dinámico (form_type de Credifamilia) que agrega el campo apuntándolo al departamento de nacimiento y lo ubica debajo de éste. Idempotente, reversible y resuelve los campos por nombre (los identificadores son autoincrementales y difieren por ambiente).

Validado en dev: el campo renderiza en su lugar y la cascada carga las ciudades del departamento elegido.

Paso post-deploy obligatorio: reconstruir el cache del schema del servicio de formularios, si no el front sigue mostrando el formulario anterior.
