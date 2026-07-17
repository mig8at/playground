# <Nombre> · raíz
> **estado:** al día con main · <TL;DR: qué es el ecosistema, en 1 frase>

<!-- RAÍZ = la base del ecosistema (main). Es el punto de entrada: un LLM/humano
     arranca acá para entender el todo. Documentación productiva, siempre al día con main.
     Es el HOGAR de lo transversal que ningún flujo dueña (estados, datos, frontera de pruebas):
     los flujos referencian esto en vez de repetirlo. Secciones sin marca = obligatorias. -->

## Qué es
<El sistema en 1–2 párrafos: qué hace, actores, modelos. La foto grande.>

## Arquitectura
<Los repos y cómo se reparte la lógica: qué corre dónde, acoples, base de datos compartida, etc.>

## Datos / tablas clave
<!-- Transversal: los flujos lo consultan, ninguno lo dueña. Compacto + puntero al censo completo. -->
<Entidades centrales + las capas de config (entidad/comercio/sucursal/categoría) + dónde deciden. Bugs de datos vivos.>

## Estados y catálogos
<!-- Lugar canónico de las máquinas de estado; los flujos apuntan acá y NO las repiten. -->
<El/los catálogo(s) de estado, la frontera (ej Estado 11), y los namespaces que se confunden (solicitud vs préstamo vs lender_transaction).>

## Frontera de pruebas / harness
<!-- Mapa GLOBAL de simulación + cheat-sheet. Clave para el OKR de pruebas; sin hogar en los flujos. -->
<Cómo despacha el harness por response_type · qué es inyectable vs frontera dura · cheat-sheet de mocks/bypasses/stashes · receta de usuario sintético.>

## Deuda técnica / hardcodes <!-- (opcional) -->
<Puntero al inventario de hardcodes con archivo:línea + los ítems load-bearing (bugs P0 vivos, copias de reglas por sucursal).>

## Cómo se lee este árbol
<El modelo: la RAÍZ es la base (main); los FLUJOS cuelgan de acá (documentación de cada flujo,
al día con main); las TAREAS cuelgan de los flujos (trabajo con ramas propias por repo).>

## Convenciones
<Nomenclatura de negocio, ramas base, reglas de oro del ecosistema. Incluí el GLOSARIO + las
colisiones de ID (ej allied 24 vs lender 24) para que los flujos no repitan la advertencia.>

## Bitácora
<!-- fechado, append-only: solo cambios ESTRUCTURALES del ecosistema -->
- **YYYY-MM-DD** — <qué cambió y por qué>

## Enlaces
<Índices/docs maestros del ecosistema · memorias.>
