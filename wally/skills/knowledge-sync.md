# knowledge-sync: revisar si un tema de la biblioteca quedó viejo porque el código cambió

Cada tema guarda sus **fuentes** (archivos de los repos) y el commit con que se revisó. Cuando una fuente cambia en
`main`, la sección que respalda puede haber quedado vieja.

| comando | para qué |
|---|---|
| `changes` | las fuentes que cambiaron en `main` desde su revisión, en toda la biblioteca: empezá acá |
| `sources tema` | las fuentes de un tema, cuáles cambiaron y qué secciones respalda cada una |
| `diff tema repo:ruta` | lo que cambió en esa fuente desde la revisión hasta `main`, con los commits |

```command
changes
sources creditopx-quota
```

El recorrido: `sources` → `diff` de cada fuente que cambió → `make knowledge-read ID=tema#seccion` de las secciones
que respalda → código sólo si el diff no alcanza (`help code`). Después decidí, sección por sección, si **sigue
cierta**, si **cambió**, si **falta algo** (el código suma un comportamiento que el tema no cuenta) o si **no se puede
saber**. Si la sección compara los dos monolitos (legacy-backend y legacy-application), mirá el cambio en los dos.
**No escribís nada**: proponés, y Miguel o Claude lo verifican y lo aplican. Una propuesta por sección:

```
### Propuesta · tema#seccion
Veredicto: sigue cierta | cambió | falta algo | no se puede saber
Por qué: qué cambió (archivo:línea en main, y el commit) y por qué afecta o no a la sección.
Texto nuevo: (si cambió o falta algo) el párrafo corregido o el que se agrega, en el estilo del tema.
Fuentes: qué fuentes hay que volver a sellar con el commit de main.
```
