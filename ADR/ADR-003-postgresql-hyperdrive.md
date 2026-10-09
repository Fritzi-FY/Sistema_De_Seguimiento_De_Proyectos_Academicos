# ADR-003: PostgreSQL gestionado con Hyperdrive

- Estado: Aceptado; proveedor sujeto a verificación de plan.
- Fecha: 2026-10-08.

## Decisión
Usar PostgreSQL gestionado externo, con Neon como candidato inicial, y Cloudflare Hyperdrive para el pool de conexiones desde Workers.

## Justificación
PostgreSQL satisface las relaciones, transacciones y restricciones del dominio. Hyperdrive reduce la sobrecarga de conexión desde Workers.

## Consecuencias
El costo, límites, región, backup, pausa por inactividad y conectividad dependen del proveedor elegido. Hyperdrive no reemplaza índices ni diseño de consultas. Revisar consistencia de lecturas cacheadas tras escrituras.
