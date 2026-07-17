# <Nombre> · group
> **estado:** al día con main · <TL;DR: qué familia agrupa, en 1 frase>

<!-- GROUP = una FAMILIA de flujos que comparten tronco (ej los dos sombreros de CreditOp:
     operador CreditopX rt=2/3 vs bróker rt=0/1/4). Documentá acá lo COMÚN a todos los
     miembros — el tronco se escribe UNA vez acá y los flujos hijos solo cuentan su DELTA.
     Documentación productiva sobre main. Secciones sin marca = obligatorias. -->

## Qué es
<Qué unifica a la familia (el response_type / el sombrero) y qué comparten sus miembros, en 1 párrafo.>

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | <común a la familia> |
| ¿Quién pone la plata / cobra? | <> |
| ¿Cómo cierra? | <> |
| ¿Simulable E2E? | <> |

## Cómo funciona
<El TRONCO compartido: el recorrido común de la familia punta a punta. Los miembros heredan esto y solo cambian su delta.>

## Estados y códigos
<Estados/códigos compartidos por la familia (referenciá el catálogo global de la raíz).>

## Sistemas externos <!-- (opcional) -->
<APIs/portales que toca la familia (los distintivos; el tronco común se referencia).>

## Dónde mirar
<!-- la superficie COMPARTIDA por subsistema → archivos clave -->
- **<subsistema>** (<repo>): `archivo`, `archivo` — <qué hace>.

## Frontera de simulación / harness
<Qué es inyectable vs frontera externa a nivel de la familia · qué mockear · seeders comunes.>

## Miembros
<!-- los flujos hijos + su DELTA en 1 línea cada uno; el detalle vive en cada nodo hijo -->
- **<flujo>** — <en qué se diferencia del tronco>.

## Gotchas / riesgos
<Lo no-obvio compartido por la familia.>

## Bitácora
<!-- fechado, append-only -->
- **YYYY-MM-DD** — <qué cambió y por qué>

## Enlaces
<Análisis maestro · docs de la familia · memorias.>
