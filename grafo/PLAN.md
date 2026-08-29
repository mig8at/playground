# El bucle con agentes, aterrizado

Idea de Miguel (2026-08-29), prototipada en `index.html`. Esto no es documentación de algo que corra:
es el diseño que el prototipo sirve para discutir. Lo que hoy existe de verdad está marcado.

## El ciclo

    merge a main  →  el centro LEE y PLANIFICA  →  N agentes trabajan  →  se COMPACTA en el repo
                     (qué entró, cuántos temas,      (cada uno itera        (revisiones/<sha>.md:
                      arreglo o tarea completa,       hasta concluir)        mapa + avance)
                      y una tarea por agente)

## 1 · El disparador

**Sólo merges a `main`.** El corpus describe lo mergeado, no lo prometido, así que un PR abierto no
dispara nada. Ya existe: `/api/ronda` compara todo lo declarado contra el árbol de main.

## 2 · El centro: leer y planificar

⚠ **No lee «todos los README».** Se probó la idea y no paga: los README envejecen y no dicen qué
archivo cumple qué objetivo — el planificador terminaría clasificando con información vieja y cara.
Lee lo que ya es exacto y barato:

| entrada | de dónde sale | cuesta |
|---|---|---|
| qué archivos declarados cambiaron, **y qué tema los declara** | la ronda | nada, ya corre |
| la descripción del PR y sus commits | el expediente | nada, ya corre |
| el diff de esos archivos | el expediente | barato: sólo los declarados |
| la prosa de los temas tocados | el corpus | barato: son los temas, no el repo |

De 23 archivos en un merge, los declarados suelen ser 3 o 4: **el primer filtro es gratis y descarta
el 80%**. Lo que el centro produce es el plan: una tarea por agente, con su tema, su clase
(*arreglo* / *tarea completa*) y sus archivos ancla.

⚠ Y el ancla son los archivos, pero **lo que define la tarea es la afirmación en juego**: no «mirá
este archivo» sino «¿sigue siendo cierto que el plan de pagos se recalcula en un paso posterior?».
Un agente sin esa pregunta no sabe cuándo terminó.

## 3 · Los agentes

**Nacen en caliente, y hay un techo de 10 vivos.** No existen desde el principio: aparecen cuando hay
una tarea y un cupo. El escritor y el verificador son el caso obvio — no tienen nada que hacer hasta
que un lector diga «ya no», así que aparecen recién ahí.

El techo no es estético: cada agente cuesta tokens y contexto, y un merge grande con treinta lectores
sueltos es la forma de gastar el presupuesto de un mes en una tarde. Si hay más tareas que cupos,
**esperan en cola**; cuando uno concluye se libera el cupo y nace otro para la que sigue. Los que ya
concluyeron no se borran: su nodo verde es el registro de que esa pregunta quedó contestada.

**Y si la tarea es chica, no se reparte.** Con dos tareas o menos, levantar un agente cuesta más que
hacer el trabajo: lo hace el centro. Un bucle que abre agentes para mirar una línea es un bucle que se
va a apagar por caro.

**El color del centro es cuánto del merge ya volvió.** Un tercio es lo suyo (leer, clasificar,
repartir) y dos tercios es lo que los agentes le entregaron — así el centro sólo se pone verde cuando
el trabajo volvió, no cuando terminó de planificar. De un vistazo se sabe cuánto de este merge está
resuelto sin leer un solo número.



Uno por tarea. Compara lo que el corpus dice contra lo que llegó, y **itera cuando lo que tiene no le
alcanza** — pide el archivo entero, pide otro archivo, vuelve a leer. Cada iteración cuesta y por eso
se ve: en el grafo le cuelga un nodo, y el número de vueltas dice cuánto le costó.

Termina en uno de tres veredictos, y el tercero es el que sostiene todo: `sigue` · `ya no` ·
**`no alcanza para saberlo`**. Forzar sí/no fabrica certeza, que es el modo de falla que este bucle
no puede permitirse.

**Techo de iteraciones**: hace falta uno (¿5?). Un agente que no converge en cinco vueltas no va a
converger en quince — y sin techo, un caso raro se come el presupuesto de todos.

## 4 · La compactación: el repo ES la memoria

Al terminar, lo concluido se escribe **en el mismo repositorio**: `revisiones/<sha>.md` con el mapa de
lo que se miró, el veredicto de cada tarea, las iteraciones que le costó y los archivos con su hash.

Eso resuelve dos cosas de un tiro:

1. **Auditar.** Cualquiera abre el archivo y ve con qué evidencia se concluyó. Sin eso, un bucle
   automático es una caja negra que un día abre un PR y nadie sabe por qué.
2. **Reanudar.** Si el proceso se cae —y se va a caer— el que vuelva lee la revisión y sigue donde
   estaba. Nadie repite trabajo, y lo importante: **nadie vuelve a pagar los tokens ya pagados**.

**Dónde vive mientras corre.** La revisión se commitea en la rama de la corrida (`canon/corrida-<sha>`)
a medida que cada agente concluye — no al final. La rama ES el checkpoint, y cuando el bucle termina,
esa misma rama es el PR. Sin base de datos y sin infraestructura nueva: git ya es el almacén, la
comparación, la aprobación y la auditoría.

## Qué existe hoy y qué falta

| pieza | estado |
|---|---|
| triaje (la ronda) | **corre** — `/api/ronda`, y el workflow diario |
| expediente | **corre** — `canon -expediente <tema>` |
| registrar cómo trabajó cada agente | **corre** — `/api/corridas`, con su vocabulario cerrado |
| escribir al corpus por la misma puerta que las personas | **corre** — el dictado, hoy tras interruptor |
| abrir el PR solo | **probado** — el publicador ya abrió uno real |
| el planificador, los lectores, el verificador | **faltan**: piden una llave de modelo en el servidor |
| permisos de escritura de la App | **faltan**: los tiene que dar Dani |
| `revisiones/` y la reanudación | **falta**: es lo nuevo de este diseño |

## Lo que queda por decidir

- **Cuánto cuesta un merge grande.** Cinco agentes × cuatro iteraciones × el archivo entero no es
  gratis. Antes de encenderlo hay que medir un merge real y ponerle presupuesto.
- **Quién aprueba.** El destino sigue siendo un PR con un humano. La pregunta abierta es si los
  cambios de nivel 1 (mover rutas en un `map.json`, verificable contra el árbol sin leer contenido)
  pueden auto-aprobarse. Los de nivel 3 (la prosa) no: de ahí salieron todas las regresiones medidas.
- **Qué pasa si el planificador se equivoca.** Si clasifica mal, los agentes trabajan sobre la
  pregunta equivocada y el resultado se ve bien. La defensa barata: el plan también se guarda en la
  revisión, así el error queda a la vista en el PR en vez de disolverse.
