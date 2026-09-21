---
id: 74
title: "Canon"
clase: proyecto
stage: work
created: "2026-09-07T08:30:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de Canon. Reúne las mejoras del corpus, la cola de preguntas que Canon
no pudo contestar y el bucle de agentes. El corpus debe mostrar únicamente conocimiento técnico, de
negocio y de producto vigente; el estado observado en `main` se conserva aunque esté bien o mal y la
historia no se mezcla con la respuesta actual.

La limpieza grande quedó mergeada en un único PR. Las tareas locales anteriores de corpus, cola y
bucle se absorbieron aquí; sus detalles siguen disponibles en Git y no se copian como diario.

⚠ **BLOQUEADO EN PROD, y no por canon.** El PR #267 está en `main` y **no desplegado**: prod sirve 33
temas y `main` tiene 34. Un commit en `config-ci` (19:54 del 2026-09-21) manda el deploy a la cuenta
de desarrollo, donde el task definition `canon-production` no existe. Rompe las CUATRO herramientas
del repo compartido, no sólo canon. El detalle y el arreglo de una línea, en el Registro de hoy.

**El próximo paso es:** que alguien CON ESCRITURA en `config-ci` aplique el arreglo — la cuenta
`mig-creditop` es de sólo lectura ahí y el repo no permite fork, así que desde acá no se puede ni
abrir el PR. El parche está listo en `~/Desktop/config-ci-environment.patch` y el diff en el Registro
de hoy. Hasta entonces lo que se dicte a canon queda en `main` sin llegar al equipo. Después, registrar acá
la siguiente mejora concreta del corpus con su criterio de terminación.

## Frentes activos

- **Corpus vigente:** mantener sincronía con `main` y separar conocimiento actual de antecedentes.
- **Preguntas sin respuesta:** distinguir huecos de conocimiento de consultas que requieren datos,
  permisos o una herramienta distinta.
- **Bucle de agentes:** medir cada mejora con casos reales y conservar recuperación cuando un agente
  o una fuente no alcance.

## Pendientes

- [ ] Elegir la siguiente pregunta real de la cola y clasificar su causa antes de escribir contexto.
- [ ] Verificar cualquier cambio del corpus contra `main` y los documentos de negocio vigentes.
- [ ] Mantener un solo estado vigente arriba; los hechos del día van al Registro.

## Registro

### 2026-09-21 · el deploy de canon está roto, y no por nada de canon

El PR #267 mergeó (12 reglas + el tema `negocio`) y **el deploy falló**. No es del cambio: tocó 16
archivos, todos `tools/canon/content/`.

> **MEDICIÓN · 2026-09-21** — la causa está en OTRO repo. `Creditop-SAS/config-ci` recibió `e1a3e5f7`
> («fix deployment development», dsanchezops) a las **19:54**, justo entre el deploy que funcionó
> (#266, 19:32) y el que falló (#267, 20:47). El diff entero es una palabra en `deploy-task.yaml`:
> la rama del `case` pasó de `development)` a `develop)`. Verificado: los inputs de los dos runs son
> idénticos y lo único distinto es el SHA del workflow reusable.
> Reproducible: `gh api repos/Creditop-SAS/config-ci/compare/19cda456...e1a3e5f7`.

**La cadena, que es lo que lo hace no obvio:** `canon.yaml` declara `environment: "production"`, pero
`frontend-monorepo.yaml` llama a `deploy-task.yaml` **sin pasar `environment`**, así que ahí se pierde
y entra el default del reusable, que es `"develop"`. Antes eso no matcheaba `development)` y caía a
`*)`, que deja el ARN vacío — y el paso de credenciales tiene `if: steps.role.outputs.arn != ''`, o
sea que se salteaba y `aws` corría con las credenciales del runner, que sí ven `canon-production`.
Ahora `develop` sí matchea, asume el rol de la cuenta de desarrollo, y `canon-production` no existe
ahí: `Unable to describe task definition`.

⚠ **No es sólo canon: son las CUATRO herramientas del repo compartido.** `credibot` falla idéntico
—medido, run `35650345487`: mismo rol, mismo error con `credibot-production`— y `cuadrilla` y `home`
pasan por el mismo camino con `*-production`. Canon falló dos veces (20:29 y 20:47), credibot dos
(20:00 y 20:19).

> **MEDICIÓN · 2026-09-21** — **prod quedó servido con la versión anterior**: `/api/estado` devuelve
> **33 temas** y `main` tiene **34**. Las 12 reglas y el tema `negocio` están mergeados y NO
> desplegados. Re-correr el workflow no sirve: `config-ci@main` sigue con el bug.
> Reproducible: `curl -s https://canon.playground.creditop.com/api/estado`.

**El arreglo son DOS líneas**, las dos en `config-ci`, y están escritas y validadas
(`~/Desktop/config-ci-environment.patch`):

```diff
--- a/.github/workflows/frontend-monorepo.yaml
       secret_name: ${{ inputs.secret_name }}
+      environment: ${{ inputs.environment }}
     secrets: inherit

--- a/.github/workflows/hotfix-deploy.yaml
       secret_name: ${{ inputs.secret_name }}
+      environment: production
     secrets: inherit
```

Con eso los deploys de producción vuelven a caer a `*)` como antes, y el `develop)` de dsanchezops
sigue sirviendo para lo que sí va a desarrollo. Los dos llamadores ya SABEN su ambiente
—`frontend-monorepo` lo recibe como input y `hotfix-deploy` es producción por definición—, así que
esto es reenviar un valor que ya existe, no inventar configuración.

⚠ **Y `hotfix-deploy.yaml` tenía el mismo defecto sin que nadie lo hubiera notado**: apunta a
`<servicio>-production` y tampoco reenviaba `environment`, así que el próximo hotfix habría fallado
igual — en el peor momento posible para descubrirlo. Verificado que con estas dos líneas **no queda
ningún llamador** de `deploy-task`/`deploy-tasks` sin reenviarlo.

⛔ **No se pudo abrir el PR:** `mig-creditop` tiene `push=false` en `Creditop-SAS/config-ci` (contra
`push=true` en `playground` y `legacy-backend`), y el repo es privado con `allow_forking=false`. O
sea: ni rama, ni fork, ni merge. Lo tiene que aplicar alguien con escritura — dsanchezops es el
natural, que además es el autor del commit que lo destapó.

⚠ Y lo que NO verifiqué: que el camino `*)` funcionara por las credenciales ambientes del runner de
CodeBuild lo deduzco del diff y del `if:` que saltea el paso — no leí el rol del runner contra AWS.
Es la única diferencia entre un run verde y uno rojo, así que la deducción es firme, pero es
deducción.


### 2026-09-19

Se consolidaron `canon-corpus-al-dia`, `canon-la-cola-de-lo-que-no-pudo`,
`canon-mejoras-del-bucle` y la tarea cerrada de Confluence. Desde hoy toda mejora local de Canon se
registra en esta tarea.
