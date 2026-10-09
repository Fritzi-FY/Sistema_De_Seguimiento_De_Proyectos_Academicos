# 6. Estrategia de pruebas y calidad

## 6.1 Pirámide obligatoria

1. **Unitarias:** dominio, reglas de autorización, cálculo de progreso, transiciones Kanban y políticas de IA. Rápidas, deterministas y sin red.
2. **Integración:** API + base de datos de prueba, migraciones, transacciones, repositorios y autorización con datos aislados.
3. **Contrato:** endpoints y esquemas alineados con OpenAPI; respuestas y códigos HTTP consistentes.
4. **E2E:** Playwright para flujos críticos del navegador.
5. **Carga:** k6 en staging con dataset sintético.
6. **Smoke en producción:** comprobaciones ligeras tras desplegar; nunca pruebas de estrés contra producción.

## 6.2 Casos mínimos

- Registro/login OAuth exitoso y denegación de dominio no permitido.
- Login por correo con verificación y recuperación segura, si se habilita.
- Usuario sin sesión no accede a rutas privadas.
- Estudiante A no puede acceder al proyecto privado de estudiante B.
- Docente no asignado no puede revisar un proyecto ajeno.
- Crear proyecto, equipo y membresía.
- Crear tarea, asignar responsable, mover de columna y verificar persistencia.
- Rechazar columna destino de otro tablero.
- Registrar comentario, avance, entregable y revisión.
- Auditoría generada para cambios relevantes sin secretos.
- Reporte respeta permisos.
- IA devuelve estructura válida; timeout/error/429 del proveedor produce degradación controlada.
- Límites de uso de IA se aplican y se prueban con proveedor simulado.
- Paginación, filtros, ordenamiento y límites de payload.
- Migraciones aplican desde base vacía y desde versión anterior de prueba.

## 6.3 Herramientas

- Vitest para unitarias e integración del código TypeScript.
- PostgreSQL de prueba aislado; puede ejecutarse localmente con Docker o utilizar una instancia de CI efímera si se configura.
- Playwright para E2E.
- k6 para carga.
- MSW o adaptadores fake para simular Google/OpenRouter/correo en tests.
- Cobertura como señal, no como único criterio de calidad.

## 6.4 Umbrales iniciales de aceptación de carga

Ejecutar primero en un ambiente staging equivalente en configuración, pero con recursos/datos seguros. La carga debe ser gradual:

1. Smoke: 1–2 VUs, 1–2 minutos.
2. Línea base: 10 VUs, 5 minutos.
3. Carga objetivo inicial: ramp-up hasta 50 VUs, 10 minutos.
4. Spike opcional: incremento corto hasta 75 VUs, solo si la prueba anterior es estable y el presupuesto/servicio lo permite.

Criterios propuestos para endpoints ordinarios de lectura/escritura, sin incluir latencia externa de IA:

- p95 ≤ 500 ms en staging.
- tasa de error < 1% en la carga objetivo.
- no hay violaciones de autorización ni corrupción de datos.
- pool/Hyperdrive y PostgreSQL no muestran agotamiento de conexiones.
- la memoria/CPU/cuotas del Worker no superan límites del plan.

Estos valores son metas iniciales, no afirmaciones de rendimiento. Si no se cumplen, identificar el cuello de botella y registrar resultados reales; no esconder fallas aumentando límites sin análisis.

## 6.5 Seguridad y resiliencia

- Pruebas de acceso no autorizado, IDs manipulados, payloads inválidos y límites de frecuencia.
- Pruebas de fallo de IA, correo y base de datos.
- Pruebas de migración y recuperación cuando el proveedor lo permita.
- Verificación de secretos: escaneo de repositorio y revisión de logs.

## 6.6 CI: condición para merge

Un PR no se integra si fallan lint, typecheck, unit tests, integration tests, contrato OpenAPI o build. E2E puede ejecutarse en PR para flujos críticos y en un pipeline de staging. La prueba de carga completa se ejecuta en staging programada o manualmente, no en cada commit.

## 6.7 Evidencias académicas

Conservar enlaces o capturas verificables de: ejecución CI, resultados de tests, PR, historial de ramas/commits, reporte k6, métricas del despliegue, HTTPS activo, documentación OpenAPI y diagramas C4 actualizados.
