# Schemas reales del flujo dinámico

Dejá acá el schema REAL de un comercio como `<partner_hash>.json` y `mock-forms` lo servirá en
lugar del genérico (lo dice en su log: `→ REAL (schemas/*.json)`).

Cómo conseguirlo — **con VPN**, pidiéndoselo al servicio de dev:

```bash
curl http://onboarding-forms-service.inertia-develop:8092/v1/dynamic/<hash>/schema \
  > mock-forms/schemas/<hash>.json
```

Por qué no se puede en local sin eso: el `onboarding-forms-service` (Go) **sí compila y levanta**
localmente, pero lee los schemas de **S3** y con las credenciales del `config.example.yaml` la
llamada devuelve `S3 HeadObject 400`. Ver findings F-41.

Hashes útiles: CeluRD/SmartPay `1bfb8cd0` (RD, country 60 → flujo dinámico).
