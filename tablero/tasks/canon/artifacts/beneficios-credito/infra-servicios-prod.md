**En producción, la pila de servicios suma los permisos del backoffice y el worker de cartera.** Los tres se declaran en `environments/prod/ecs-application/terragrunt.hcl`.

- **`access-service`** atiende en el puerto 8084, detrás del balanceador interno (`access.production.internal.creditop.com`). Lee las políticas de autorización de un bucket de S3 propio y se conecta a su base con un token IAM de su rol, no con contraseña.
- **`cerbos`** decide los permisos con esas mismas políticas: las toma del bucket, bajo `current/policies`, y vuelve a mirar cada 30 segundos. Un cambio de política llega sin desplegar. Los dos escalan entre 2 y 50 tareas.
- **`loan-servicing`** corre con una sola tarea y sin autoescalado. Su rol sólo le permite lanzar tareas de la familia `legacy-application-worker-production` y pasarles los roles del worker del monolito viejo: así lanza la cadena nocturna de cartera.

⚠ **La familia que lanza la decide su configuración, no la infraestructura.** Por defecto, `loan-servicing` apunta a `legacy-application-scheduler`, que su rol no puede lanzar. Si la cadena nocturna falla por permiso al salir del modo sombra, lo primero es revisar `nightly.ecs.task_family` del worker. El worker y su modo sombra: [[arquitectura/context#apagar-el-sistema-viejo-exige-cubrir-avisos-y-operacion-programada]].
