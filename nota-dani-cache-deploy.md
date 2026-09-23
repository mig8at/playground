# Corregir colisión de caché al desplegar herramientas

## Problema

Si un mismo commit modifica más de una herramienta, sus despliegues usan la misma caché de imagen:

```text
docker-image-${{ github.sha }}
```

Entonces un deploy puede restaurar la imagen de otra herramienta. Ejemplo real: el deploy de Canon cargó
`creditop/credibot:<sha>` y luego falló al intentar etiquetar `creditop/canon:<sha>`.

## Cambio

En `Creditop-SAS/config-ci`, incluir el repositorio ECR en la clave de caché.

Archivo: `.github/workflows/build-frontend-monorepo.yaml`

```yaml
# antes
key: docker-image-${{ github.sha }}

# después
key: docker-image-${{ inputs.ecr_repository }}-${{ github.sha }}
```

Archivo: `.github/workflows/push-image.yaml`

```yaml
# antes
key: docker-image-${{ github.sha }}

# después
key: docker-image-${{ inputs.ecr_repository }}-${{ github.sha }}
```

## Resultado esperado

Cada herramienta restaura exactamente su propia imagen, aunque Canon, Credibot, Home y Cuadrilla se
desplieguen desde el mismo commit.

## Validación

Hacer un commit que modifique dos herramientas y verificar que cada job cargue una imagen con su propio
nombre, por ejemplo `creditop/canon:<sha>` y `creditop/credibot:<sha>`.
