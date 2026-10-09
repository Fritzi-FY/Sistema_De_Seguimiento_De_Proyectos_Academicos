# ADR-007: Caché incremental y basada en evidencia

- Estado: Aceptado.
- Fecha: 2026-10-08.

## Decisión
Usar CDN para assets estáticos, caché de cliente controlada y Hyperdrive para pooling; no añadir Redis/KV inicialmente. Respuestas privadas no se cachean en CDN compartido por defecto.

## Justificación
Primero se miden consultas y latencia. Una caché distribuida adicional añade complejidad de invalidación y riesgo de datos obsoletos. Evaluar una caché nueva solo tras demostrar un cuello de botella y definir consistencia/TTL.
