## 1. Revisión previa

- [x] 1.1 Autorización D: misma rama, sin importar Maps y solo is488_dev; sin Git de escritura.
- [x] 1.2 Trazar puertos/escenarios, locks, retiro, orden y contratos existentes.

## 2. Esquema y migrador

- [x] 2.1 Añadir 0003 y manifest; ensayar DDL desde esquema vacío efímero en is488_dev y actualización real 2→3, preservando datos/hashes y probando inicialización concurrente y aislamiento. No crear otra base.
- [x] 2.2 Extender ACL evolutivas; verificar permisos runtime, denegaciones DDL/ledger/actividad UPDATE/DELETE y matriz por versión con casos negativos.
- [x] 2.3 Conservar protocolo y evidencia aprobada COMMIT/cierre/reconciliación; verificar nuevo DDL con rollback y pérdida real de COMMIT Kanban sin retry ni rollback histórico inventado. No repetir suites que crean otras bases.

## 3. Adaptadores y composición

- [x] 3.1 Repositorios SQL y listado; verificar límites 1/10, snapshot página/total, filtros literales, orden y permisos.
- [x] 3.2 Creación/edición/asignación atómicas; CREATED/UPDATED, no-op, campos inmutables, responsables inválidos, carrera con retiro y repeticiones.
- [x] 3.3 Movimiento y eliminación/reasignación; clamping, sesiones concurrentes, orden contiguo e historial retenido.
- [x] 3.4 Inyectar fallos entre estado/eventos y pérdida de conexión; todo-o-nada o resultado incierto sin retry, cierre separado.
- [x] 3.5 Selección completa SQL/Maps; contratos, aislamiento y regresiones afectadas sin SQL en modo Maps explícito.
- [x] 3.6 Tras aprobación expresa, aplicar 0004 sin cambiar 0003, conservando las ocho tablas y verificando repeticiones en creación/edición/lectura/reinicio.

## 4. Verificación y documentación

- [x] 4.1 Recorrido frontend/proxy/API/PostgreSQL real; parar y reiniciar PostgreSQL, Wrangler y Vite y comparar columnas/tareas/responsables/historial exactamente.
- [x] 4.2 Tipos, lint, formato, SQL focalizadas, Maps/HTTP/OpenAPI, build API dry-run y OpenSpec. Cerrar conexiones de pruebas y conservar fixtures identificados, sin borrar proyectos/membresías ni tocar otras bases.
- [x] 4.3 Actualizar modelo, guía y resultados reales. Sin archivo/sincronización canónica, integración o despliegue no autorizados.

Evidencia: design.md y evidence/kanban-postgresql/. Dieciséis casos SQL distintos, dos pruebas ACL, 76 regresiones Maps/HTTP/sesión/composición, 21 comprobaciones OpenAPI y un caso Maps explícito verificados. Las exclusiones por filtros no se cuentan como aprobadas. Contadores remotos conservados: 143/220 y 1020/2200.
