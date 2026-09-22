---
id: 91
title: "Trazador"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta tarea tiene **dos frentes**, y conviene no mezclarlos.

**1 · El tracer del equipo (en curso, 2026-09-22).** El trazador se está mudando al playground
compartido como `tools/tracer`, para que lo use el equipo y no sólo esta máquina. Está en la rama
`tracer/nace` de `Creditop-SAS/playground`, **sin PR todavía**, con `task ci` en verde y probado
contra producción de punta a punta. Lo que cambia respecto de acá: un solo ambiente (prod, por
Redash), sin los modos de consola, código y archivos en inglés, y datos de clientes sin ofuscar
—decisión de Miguel: quien entra ya tiene Redash, donde consulta lo mismo—. **No se puede encender
hasta que infraestructura provea lo que pide `tools/tracer/README.md`.**

⚠ **El trazador de acá NO se apaga.** Se queda con lo que no viajó: `-sql`, `-slack`, `-diag`,
`-validar`, `-chequeo` y los cuatro ambientes. El de allá es la UI contra producción.

**2 · Jev para clasificar reportes (pausado).** Sus etapas, cobertura y evidencia permanecen
determinísticas. Jev puede evaluarse como ayuda semántica para clasificar un reporte, decidir si hay
evidencia suficiente y puntuar severidad, sin sustituir el mapa de etapas.

No se han enviado mensajes de Slack, logs, identificadores ni trazas reales a TypeSafe. El siguiente
experimento debe usar casos sintéticos y estados sanitizados.

Antes de eso hay un paso que no necesita modelo ni red: **mirar lo que el clasificador descarta**.
`make trazador-slack DIAS=7 SIN=1` lista los reportes que ninguna regex reconoció, con su fecha y su
texto, en la terminal. Es lo que dice si el techo de las regex es real —faltan categorías— o si es
ruido; y si faltan pocas, la respuesta son tres regex y no un modelo. El veredicto ya no puede
esconderlo: «sin clasificar» es un cuarto renglón y entra al denominador.

**El próximo paso es:** que Dani provea las credenciales del servicio `tracer` (la lista está en su
README) y decidir si el PR se abre antes o después de que exista el servicio.

## Pendientes

- [ ] Pedirle a Dani las tres fuentes para `tracer` + la puerta de Google + los recursos del servicio.
- [ ] Confirmar con Dani si el security group de `alb-internal-tools` está cerrado a la VPN: resuelve
      a IPs públicas, y de eso depende que mostrar cédulas sin llave propia sea correcto.
- [ ] Abrir el PR de `tracer/nace` (uno solo, con todo).
- [ ] Decidir qué pasa con el trazador de acá cuando el otro esté andando: hoy conviven a propósito.
- [ ] Leer los sin clasificar de 14 días y decidir: ¿faltan categorías, o es ruido?
- [ ] Definir categorías de incidente que produzcan una decisión concreta en código.
- [ ] Diseñar un estado derivado sin mensajes, ids, teléfonos ni payloads crudos.
- [ ] Conservar el clasificador actual como recuperación durante todo el experimento.

## Registro

### 2026-09-22

**El trazador se mudó al playground del equipo como `tools/tracer`** (rama `tracer/nace`, sin PR).
Seis commits, `task ci` en verde y probado contra producción con la solicitud 562414: ficha, mapa de
9 etapas, 233 registros y las tres fuentes activas.

Lo que decidió la forma: **en producción el trazador ya no usaba MySQL sino Redash**, así que quedarse
con un solo ambiente borra el único import externo de Go y la herramienta queda **sin una sola
dependencia**, que es la quinta regla escrita de ese repo. Los modos de consola no viajaron: un `-sql`
arbitrario contra producción no va adentro de una imagen desplegada, y `-chequeo` necesita el harness.

Dos índices (`workers/logs.json`, 472 KB y gitignoreado, y `workers/negocio.json`) se derivan del
código de los 12 repos y allá no hay repos que recorrer: viajan **embebidos con su fecha**, visible en
`/api/conexiones`. Un índice viejo no falla, deja de encontrar — y eso se lee igual que «no existe».

**Tres errores que sólo aparecieron corriéndolo**, ninguno con síntoma:

- La traducción a inglés movió cuatro **etiquetas `json:`** (`perfilesCupo` → `quotaProfiles`): el Go
  compila, los tests pasan, el server responde 200, y el front pierde una ficha entera. Se encontró
  comparando la misma traza de prod antes y después. Hoy lo caza `api_shape_test.go`, probado al revés.
- El `index.html` reescrito perdió `class="dark"`, y el tema declara su paleta oscura ahí sin nada que
  la active: la herramienta abría en blanco desteñido.
- **PostHog quedó desconectado**, y resultó que en el trazador de acá TAMPOCO estaba conectado a la UI:
  se consultaba en `modoTraza`, o sea sólo por consola. Allá quedó dentro de `BuildTrace` y **con el
  teléfono que la BD ya trae** — medido: de 0 a 15 pantallas, empezando por `auth_otp_screen_viewed`,
  que es la fase que sólo se ve identificando por teléfono (47.792 eventos contra 24.006).

⚠ **Y un dato del ambiente que conviene tener por escrito**: el balanceador del playground se llama
`alb-internal-tools` pero resuelve a IPs **públicas** de AWS. La VPN de esta máquina estaba puesta
durante la prueba, así que no se puede concluir que esté abierto — pero tampoco que esté cerrado. Lo
tiene que confirmar Dani, y de eso depende que mostrar cédulas sin llave propia sea correcto.

### 2026-09-21

El barrido de #tech-ops contaba los reportes que ninguna regex reconoce y los tiraba: el veredicto se
calculaba sobre los clasificados, así que hablaba de las regex creyendo hablar del canal. Ahora «sin
clasificar» entra al denominador como cuarto renglón —**no** como «fuera de alcance», que es un juicio
que nadie hizo— y `SIN=1` los lista con fecha y texto para poder mirarlos. La clasificación se extrajo
a `clasificarReportes`, que es pura y tiene prueba; probada al revés, mutando el código. No se envió
nada a ningún servicio externo: esto es local y de sólo lectura, como todo el modo Slack.

### 2026-09-19

Se creó la tarea canónica de la herramienta. No absorbió datos reales ni activó una integración.
