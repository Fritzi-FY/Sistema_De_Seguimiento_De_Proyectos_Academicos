# ADR-006: Posponer archivos binarios

- Estado: Aceptado para la primera versión.
- Fecha: 2026-10-08.

## Decisión
En la primera versión solo se guardan metadatos y enlaces de evidencias/entregables. No usar filesystem local como almacenamiento persistente en Workers.

## Consecuencia
La funcionalidad de subida de archivos queda fuera del primer incremento. Si se requiere, crear cambio OpenSpec y evaluar Cloudflare R2 u otro almacenamiento de objetos con controles de tipo, tamaño, autorización y retención.
