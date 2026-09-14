---
id: 79
title: "Confluence: qué entra a canon y qué no"
stage: work
created: "2026-09-14T18:00:00-05:00"
context_nodes: []
jira: []
jira_title: ""
ramas:
---

## Si retomás esto sin contexto, empezá acá

Confluence tiene **228 páginas** (204 en el espacio Creditop + 24 repartidas en siete espacios de
proveedores). Este archivo dice **cuáles pueden entrar al corpus técnico y cuáles no**, con el criterio
y con lo que ya se cosechó. El acceso es `make confluence CMD='…'`; la búsqueda es **AND sobre todos
los términos**, así que una frase de cinco palabras devuelve cero y parece que no hay nada.

⚠ **El token vive en `context/.env`** con los nombres `CONFLUENCE_URL · CONFLUENCE_EMAIL ·
CONFLUENCE_TOKEN`. El 2026-09-14 estaba puesto en otro archivo y con otros nombres
(`ATLASSIAN_API_TOKEN` en el `.env` de canon), así que la herramienta decía que había vencido.

## La regla, en una línea

**Entra el «estado real» verificado contra `origin/main`; no entra el «deber ser».**

Y eso NO se decide por página: **se decide por sección**. La mayoría de las páginas técnicas dicen
«Estado: en diseño» o «plan» arriba, y adentro traen un apartado —«De dónde sale hoy», «Contexto (lo
que hay hoy)», «lo que ya existe»— que describe lo que corre. Ese apartado es la cosecha; el resto es
diseño.

De las cuatro secciones que entraron el 2026-09-14, **tres salieron de páginas marcadas «en diseño»**.

## Lo que NO entra, y por qué

| qué | cuántas | por qué |
|---|---|---|
| actas con fecha por título (`2023-10-18`…) | ~38 | son minutas, no mecanismo |
| plantillas y proceso de QA (`1. QA OVERVIEW`…) | 7 | proceso del equipo, no del sistema |
| gobierno y cumplimiento (continuidad, riesgos, activos, seguridad física) | ~12 | norma organizacional; no se verifica contra código |
| guías para humanos (VPN, JKS→PEM, commits, estilo) | ~8 | receta de escritorio, no conocimiento del producto |
| RFCs y propuestas (identidad dual, serverless, CI/CD, datawarehouse) | ~8 | deber ser: describen lo que no existe |
| PRDs de integraciones no construidas (Credibanco, Cuotealo BCP, Finandina, Flamingo) | 4 | idem, y envejecen sin avisar |
| notas de versión y releases | ~4 | historia, no mecanismo |
| propuestas de negocio con proyecciones (modelo de cobro de gastos de mora) | 1 | es un escenario elegido, no lo que corre |

⚠ **Y cuatro que NO entran por otra razón: los `Hallazgo 01`–`04` de seguridad** (llave de Firebase
quemada en la app, ausencia de controles anti-root, exposición de datos personales sin autenticación,
modo depuración en producción). Son vulnerabilidades, varias posiblemente vivas. **El corpus lo lee
todo el equipo**; publicar ahí el detalle de una vulnerabilidad abierta es repartirla. Eso se atiende
por el canal de seguridad, no por canon. **Están listadas acá sin su contenido a propósito.**

## Lo que SÍ entra — cosechado el 2026-09-14

Cuatro secciones, todas verificadas contra `origin/main` antes de escribirse, y todas con el banco
quieto en 96/115 y 115/115.

| de qué página | qué entró | dónde |
|---|---|---|
| Paridad de perfilamiento | el perfilamiento no corre fuera de producción en el monolito viejo, y sí siempre en el nuevo | `listado` |
| Paridad de perfilamiento | la foto de lo evaluado omite las sub-reglas de la familia de la casa cuando la sirvió el nuevo | `listado` |
| Reglas del mínimo CreditopX | el porcentaje de cuota inicial llega al navegador ya resuelto, en cascada de tres | `cuota` |
| La librería platform y el cableado de trazas | entre servicios el único hilo es la traza; no hay identificador de negocio | `observabilidad` |

⚠ **Y en una hubo que corregir a la fuente.** La página presentaba la omisión de sub-reglas como si
cambiara **qué se aplica**. Verificado el consumidor, `hard_rules` es una columna que leen dos
pantallas de administración: es el **registro** de lo evaluado, no la decisión. Escribirlo como lo
decía la página habría mandado a alguien a depurar reglas que sí se aplican.

## Lo que queda por cosechar, en orden

Candidatos técnicos leídos por encima y no verificados todavía. El orden es por lo que promete y por
lo verificable que es:

1. **Solicitudes y estados** · **Origen de onboarding** · **Backoffice — API** — sin marca de estado,
   descriptivas, y tocan temas que canon ya cubre: alto riesgo de duplicar, alto valor si corrigen.
2. **Workflow legacy-kyc-pipeline** — el pipeline de identidad, que en la cola de preguntas aparece.
3. **Catálogo de credenciales y certificados** — marcada «diagnóstico», o sea que describe lo que hay.
4. **Device Locking (IMEI)** · **Cupo Rotativo** · **FormEngine** — mecanismos concretos y acotados.
5. **Integración Deceval** (dos páginas) y **Recaudo Referenciado / BHD** (tres) — integraciones con
   contrato; canon ya tiene Deceval en `credifamilia`.

Y lo que **no se puede verificar desde acá**: el repositorio de la librería compartida (`platform`) y
los demás microservicios del análisis **no están clonados** en esta máquina. Lo que entró de esa
página es sólo lo que se pudo comprobar en los cinco servicios que sí están.

## Cerrada la lista: 8 secciones de 15 páginas candidatas

Las cuatro últimas, y por qué tres no dieron nada — el «no» también es resultado:

| página | veredicto |
|---|---|
| **Cupo Rotativo** | es **un enlace a Figma**, sin texto. Nada que cosechar |
| **Recaudo Referenciado** | guía para el banco recaudador. Su código de respuesta `MTD00000` **no existe en ningún repo clonado**: no se puede verificar, así que no entra |
| **Integración Deceval** | ✔ **en producción**, y dio una sección: el callejón del girador |
| **FormEngine** | propuesta con forma de argumento de venta —«revoluciona», «cero deuda técnica»—, dos menciones de código en toda la página, y canon ya cubre el formulario dinámico real |

**Lo que entró de Deceval**: con el mismo documento y nombres distintos, el depósito no falla — devuelve
la cuenta en CERO, esa cuenta viaja tal cual al pagaré y lo hace rechazar, omitir el campo da el mismo
rechazo, y **no hay operación para preguntarle qué nombre tiene registrado**. Es un callejón sin salida
desde este lado, y conviene no confundirlo con la otra falla del mismo tramo, que es nuestra.

⚠ Y una vez más el paso 0 evitó un duplicado: canon **ya tenía** «la firma del pagaré no comprueba que
el depósito haya dicho que salió bien». La sección nueva apunta a ésa en vez de repetirla.

## Cómo se cosecha (el bucle que funcionó)

1. `paginas <espacio>` y leer TÍTULOS: la forma del título ya clasifica (fecha = acta, PRD = deber ser).
2. Leer las primeras ocho líneas: la línea `Estado:` dice si es diseño, plan, diagnóstico o análisis.
3. Buscar dentro el apartado de estado real.
4. **Verificar cada afirmación contra `origin/main`**, y verificar también **quién consume** el dato —
   ahí fue donde la fuente se equivocaba.
5. Escribir el mecanismo, declarar el área con sus archivos y hashes, y pasar la compuerta.
