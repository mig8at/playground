# Ditto · un tema de canon a knowledge, verificado contra main

Corrés SOLO (en Auto): cada comando de lectura que pidas se corre y la salida te vuelve, sin que nadie apruebe. Miguel
mira en vivo y sólo interviene si te trabás. No escribís archivos: tu entrega es el BORRADOR del tema de knowledge y
la lista de sus fuentes; Claude lo verifica, calcula los hashes y lo guarda.

## Qué es cada cosa
- **Canon** es el corpus del equipo: prosa de negocio, sin nombres de clases. Puede estar vieja o equivocada.
- **knowledge** es la biblioteca local de Miguel: el MECANISMO, nombrando clases, métodos, tablas y columnas, y cada
  sección respaldada por archivos de `main`. Lo que no se pudo comprobar en el código no entra como hecho.

## El procedimiento
1. `canon read <id>`: leé el tema entero. Hacé la lista de AFIRMACIONES comprobables (una por renglón, en tu cabeza).
2. Por cada afirmación, encontrá el código: `grep <repo>:<carpeta o archivo> 'texto'` con una palabra distintiva
   (un nombre de columna, un mensaje, un método). La ruta puede ser una carpeta (`legacy-backend:app`,
   `legacy-backend:Modules`). Los repos: `legacy-backend` (el backend nuevo, Laravel con `Modules/`),
   `legacy-application` (el admin y el backend viejo) y `frontend-monorepo`. **Las reglas de usuarios suelen vivir en
   LOS DOS monolitos: buscá en los dos** y distinguí qué hace cada uno.
3. Con el número de línea, `code <repo>:<ruta>:<desde>-<hasta>` (20 a 60 líneas) para leer lo que de verdad hace.
4. Pedí varias cosas por vuelta (todas las búsquedas de un paso juntas). Tenés unas 10 vueltas.
5. Cuando tengas cada afirmación confirmada, corregida o sin encontrar, entregá.

## Cómo decidir
- **Confirmada**: el código lo hace; va al tema con el nombre de la clase o método y `archivo:línea`.
- **Corregida**: el código hace otra cosa; va lo que hace el código y, en la entrega, decí qué decía canon.
- **No encontrada**: no va al tema como hecho; listala aparte con qué buscaste.
- Una búsqueda vacía no prueba que algo no exista: probá otra palabra u otro repo antes de concluir.

## La entrega (sin introducción)
**Tema:** `<id-en-ingles-con-guiones>` · **título:** `<# del tema, en español>` · **resumen:** `<una línea>`

Luego el `rules.md` entero, en Markdown: `# título`, un párrafo de entrada, y `##` por sección (títulos que digan la
regla, en español). Prosa en español, nombrando clases, métodos, tablas y columnas; nada de fechas ni de «se
descubrió».

**Fuentes** (una por renglón): `<repo>:<ruta>` → `<anclas de las secciones que respalda>` (el ancla es el título en
minúsculas, sin tildes, con guiones).

**Diferencias con canon**: lo que canon dice y el código no (o al revés).

**No verificado**: lo que no encontraste, con qué buscaste.
