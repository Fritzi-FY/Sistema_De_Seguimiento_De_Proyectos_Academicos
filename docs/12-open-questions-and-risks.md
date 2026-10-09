# 12. Riesgos y decisiones que requieren verificación

Las decisiones de arquitectura están fijadas como base, pero los siguientes puntos necesitan prueba o confirmación operativa. No son preguntas que bloqueen la documentación; son tareas explícitas de validación.

| Riesgo / incertidumbre | Tratamiento | Criterio de salida |
|---|---|---|
| Google OAuth institucional | Spike de autenticación con cuenta real y callback de preview. | Inicio válido con `@unsch.edu.pe`; dominio no permitido rechazado por backend. |
| Proveedor de correo para verificación | Comparar free tiers, límites y política de privacidad; no enviar correo manual desde Workers sin servicio. | Mensaje verificado y recuperación segura, con límite de gasto aprobado. |
| Compatibilidad ORM + Hyperdrive | Probar consulta, transacción y migración en un Worker. | Tests de integración pasan y se documentan límites. |
| Compatibilidad de biblioteca de auth con Workers | Spike temprano; no implementar OAuth/password desde cero. | Sesión, callback, cookies y pruebas de autorización funcionan en preview. |
| Límites gratuitos Cloudflare | Revisar límites vigentes al desplegar. | Prueba de carga no supera cuotas o existe decisión de gasto. |
| Nivel gratuito PostgreSQL | Verificar pausa, storage, conexiones, backups y región. | No se declara SLA/backups si el plan no los garantiza. |
| Costo de OpenRouter | Cuotas por usuario/proyecto, límite de tokens y presupuesto. | Tests usan mocks; uso real limitado y visible. |
| Caché de consultas | Hyperdrive puede cachear lecturas sin invalidar automáticamente tras escrituras. | Rutas con consistencia inmediata no dependen de una lectura cacheada obsoleta. |
| Pruebas de carga | Usar datos sintéticos y staging aislado. | Reporte con VUs, duración, p95, errores y configuración. |
| Adjuntos | Fuera de primera versión; solo metadatos/enlaces. | Cualquier carga binaria requiere ADR/cambio OpenSpec y almacenamiento de objetos. |
| Observabilidad | Capacidades exactas varían por plan. | Verificar qué métricas/logs están habilitados en la cuenta real. |
| Plazo académico | Mantener MVP vertical antes de funciones no esenciales. | La primera demo funciona antes de implementar todo el alcance. |

## Alternativas que se rechazan inicialmente

- **Microservicios:** demasiado costo operativo para la escala inicial.
- **Redis desde el día uno:** no existe aún una línea base que justifique una caché distribuida.
- **Cloudflare D1:** no satisface la decisión de usar PostgreSQL.
- **Filesystem local para adjuntos en producción Workers:** no es una estrategia de persistencia válida para este runtime; se pospone la carga binaria.
- **IA obligatoria para el flujo principal:** agrega costo y un punto de falla innecesario.
- **Claude Code de pago desde el inicio:** no es necesario si Antigravity cubre el flujo principal; reevaluar solo si una tarea demuestra una ventaja suficiente.
