Como `make fresh` no pasa por la guarda, la práctica es correr sólo lo que valida la tarea, siempre con ruta:

    ./vendor/bin/sail artisan test <ruta>
    ./vendor/bin/sail artisan test --filter=<test> <ruta>
    make test-onboarding

El último ya viene acotado a `tests/Feature/E2E`, `tests/Feature/Support/Onboarding` y `tests/Unit/Support`. Antes de correr una carpeta se comprueba que no arrastre nada que recree la base:

    grep -rlE '^\s*use RefreshDatabase;|uses\(.*RefreshDatabase::class' <ruta>
    ls <ruta>/../Pest.php <ruta>/Pest.php 2>/dev/null   # y si hay, leerlo: puede atarlo al directorio

Las dos mitades hacen falta. El ancla al principio de línea es porque grepear sólo la palabra da treinta falsos positivos entre imports, comentarios y documentación. La segunda alternativa existe porque **un `uses(RefreshDatabase::class)` no empieza la línea con `use`** y el patrón anclado no lo matchea nunca. Y el `Pest.php` es la tercera forma, que no se ve grepeando los tests: hay que abrirlo.

⚠ **Ese comando sirve sobre el árbol de trabajo, no contra una RAMA**: `git grep` **no entiende la clase `\s`** en su motor de expresiones y devuelve vacío **siempre**, sin fallar — un cero que se lee igual que «no hay». Contra main va la clase POSIX:

    git grep -lE '^[[:space:]]*use RefreshDatabase;|uses\(.*RefreshDatabase::class' origin/main

⚠ **Y un archivo marcado no es un archivo que borra.** Sobre main el patrón también marca archivos que hoy no recrean nada: el `Pest.php` del módulo de solicitudes, que no borra mientras su carpeta tenga sólo pruebas comentadas; una guía de `docs/` que cita la línea; y tres pruebas que nombran el trait en `uses(...)` sin importarlo ([[local/operar#lo-que-borra-la-base-make-test-y-make-fresh-no-se-corren]]). Antes de concluir, se abre el archivo y se mira qué importa.
