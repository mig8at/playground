# Cómo indagar en los repos sin perder el día

Método destilado de lo que funcionó y lo que no entre el 9 y el 11 de septiembre de 2026, revisando dos
relevamientos completos de `legacy-backend`, `legacy-application` y `frontend-monorepo`. **Cada regla de
acá costó un error.**

El objetivo no es «encontrar cosas»: encontrar es barato y produce listas que nadie lee. El objetivo es
llegar a **mecanismos verificados que cambien una decisión** — cómo se diagnostica un reclamo, dónde se
escribe la próxima sección, qué no se puede probar en dev.

---

## 0. Antes de empezar: ¿esto ya está?

Dos minutos que ahorran una tarde.

- `context/docs/ROUTE-MAP.md` y el corpus de canon: ¿alguien ya lo escribió?
- ⚠ **Medido**: de un relevamiento de 10 secciones, **la mitad ya estaba en canon y mejor contada**. El
  bloqueo de dispositivos venía con «corte duro de 8 días» y canon ya decía que el umbral es editable
  por comercio. Escribirlo de nuevo, peor, es trabajo negativo: deja dos verdades.

---

## 1. Elegir el objetivo por DEMANDA, no por curiosidad

El código es enorme y casi todo está quieto. Tres fuentes dicen dónde mirar, en orden de rendimiento:

| fuente | qué contesta | costo |
|---|---|---|
| la cola de `canon`, en `/preguntas` | qué preguntó gente de verdad y no se pudo contestar | gratis |
| `canon -peso` | dónde se está moviendo el código, y qué áreas están quietas | gratis, medio segundo |
| `workers/cli.py cobertura` | qué lógica quemada está fuera del corpus, ordenada por dolor | gratis |

⚠ **La cola gana a las otras dos.** Es demanda escrita por personas; lo demás es lo que a uno se le
ocurrió buscar.

---

## 2. Si ya hay índice, NO grepees

`quemado` (391 lugares donde el código decide por identidad, clasificados y con los ids resueltos a
nombre de negocio) · `relaciones` · `logs` · `buscar` · `gemelos`.

⚠ **Medido**: siete fases de `grep` re-derivaron, peor, un subconjunto de lo que `quemado` da en un
comando. **Si vas a grepear lo mismo dos veces, eso no es una consulta: es un índice que falta.**

---

## 3. Grep para VERIFICAR, no para descubrir

Es lo mejor que hay para confirmar o refutar una afirmación concreta, y flojo para explorar.

    git -C <repo> show origin/main:<ruta>        # el archivo como está en main
    git -C <repo> grep -n "<patrón>" origin/main -- '<rutas>'

⚠ **Contra `origin/main`, nunca el working tree**: los repos viven en ramas. Tres secciones de un
relevamiento describían una rama con cuatro commits sin mergear y se leían como si fueran producción.

⚠ **Un cero no es un hallazgo.** Un patrón que no matchea devuelve cero, y cero se lee igual que «no
hay». Ya costó dos conteos falsos en este repo (`git grep` no entiende `\s`) y volvió a pasar en cuatro
de las siete fases del relevamiento. **Regla: todo patrón se prueba primero contra un caso que TIENE que
matchear.**

⚠ **Y un uno tampoco.** Cuando la afirmación tiene la forma «esto lo escribe X», el grep tiene que
devolver **todos** los escritores antes de escribir una sola línea — no el primero que confirma la
hipótesis. Pasó el 2026-09-11: el borrador decía «la marca del código de compra la escriben los tres
procesos nocturnos de facturación», que era lo que sugería el primer archivo abierto. El grep completo
encontró **cinco**, y los dos que faltaban eran controladores en tiempo real: con tres, «revisado»
significaba «llegó la factura»; con cinco, significa «alguien lo marcó y la fila no dice cuál». La
afirmación no era imprecisa, era **otra**.

    git -C <repo> grep -ln "<columna>" origin/main        # QUIÉNES la tocan
    # y recién después, por cada uno: ¿lee o escribe?

---

## 4. Las tres preguntas que el grep no contesta

Un hallazgo sin estas tres respuestas todavía no es un hallazgo:

1. **¿se alcanza?** Seguí las llamadas y las rutas. Un modelo de riesgo que le pegaba a un entorno de
   pruebas personal resultó alcanzable **sólo desde dos controladores de prueba**: el relevamiento lo
   contaba como si estuviera en el camino del cliente.
2. **¿es la norma o la excepción?** Contá. «El documento se elige por el id de la entidad» cambia de
   sentido cuando sabés que **siete** entidades tienen el suyo y el resto usa el genérico.
3. **¿se ejecuta?** Eso no está en el código: está en los logs (`trazador-acceso` con expresión
   métrica, no la sonda), en la base de producción (sólo lectura) y en PostHog.

---

## 5. Clasificar por CAUSA, no por tema

Es el paso que más cambia el plan y el que más se saltea.

⚠ **Medido sobre las 70 preguntas que canon no pudo contestar**: clasificadas por tema parecían huecos
de corpus. Clasificadas por causa, **el 87% se había pasado del techo de pasos** — el agente ya tenía el
archivo y se quedó sin turnos. Escribir prosa no movía ninguna. El arreglo era una herramienta.

---

## 6. Escribir el MECANISMO, no el inventario

Lo que entra al corpus es lo que generaliza y no envejece con cada alta: **cómo se elige la plantilla**,
no la lista de las siete. El inventario ya lo contesta `quemado`, mejor y sin quedar viejo.

Y con las tres cosas que hacen accionable una sección:

- **los identificadores con su nombre de negocio** (el comercio 24 «Creditop», la sucursal 928
  «Creditop-Bold»). ⚠ Los saqué una vez para bajar la competencia en el ranking y el agente se pasó
  ocho pasos buscando el código sin un número con el que apuntar. **Si hay que competir menos, se
  cambia el vocabulario de la prosa; los datos no se tocan.**
- **la fecha al lado de cada medición** — el lint la exige, y con razón: un número contra un sistema
  vivo decae sin que cambie ningún archivo;
- **qué hacer con eso**: el orden de diagnóstico, o qué mirar primero.

⚠ **Nunca datos de personas.** El hallazgo es «las alertas van a una casilla personal», no la dirección.

---

## 7. Validar antes de cantar victoria

- `canon -lint` y **`canon -bench`**: 115/115 es **compuerta de build**, no métrica. Si baja, la causa
  casi siempre es que la prosa nueva le robó las palabras a una pregunta vieja — se arregla cambiando
  el vocabulario de LA NUEVA, nunca parcheando la sección ajena.

  **Y el diagnóstico sale gratis:** corré el banco con y sin tus cambios y comparé las listas de
  «recuperado entre los 3 primeros». La que aparece sólo en la lista nueva es la que desplazaste — dos
  corridas de una compuerta que ya ibas a correr, cero tokens de modelo.

      canon -bench 2>&1 | grep "recuperado entre los 3" | sed 's/.*· //' | sort > /tmp/con.txt
      git stash -- content && canon -bench … > /tmp/sin.txt && git stash pop
      comm -13 /tmp/sin.txt /tmp/con.txt

  ⚠ **Y suele ser UNA palabra, no la sección entera.** El 2026-09-11 una sección de identidad usaba
  «registro» con el sentido de *registraduría*; en este corpus «registro» quiere decir *rastro*, y le
  robó «la biometria no dejo registro». Cambiada esa palabra —y sólo esa—, el banco volvió a 96. Antes
  de reescribir un párrafo, mirá qué término comparten los dos textos.
- Buscá cada sección nueva **con la pregunta con que llegaría de soporte**. Si no sale primera, no la
  va a encontrar nadie.
- Y después del merge, **dos preguntas nuevas contra producción**, nunca del banco.

---

## El ciclo, en una línea

**demanda → índice → verificación contra `main` → las tres preguntas → causa → mecanismo → compuerta →
dos preguntas en prod.**

Lo que se saltea seguido y siempre se paga: el paso 0 (ya estaba), el 3 (el cero que no es hallazgo) y
el 5 (clasificar por causa).
