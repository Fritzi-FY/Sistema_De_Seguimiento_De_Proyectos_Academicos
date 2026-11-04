## 1. Decisiones y spike, sin autorización implícita

- [x] 1.1 Decisión humana registrada: cuentas sintéticas preautorizadas por herramienta local, solo correos provisionados, autoridad administrativa explícita del servidor y sesión máxima de 8 horas sin recordarme. No inferir docente por dominio ni apertura de registro público.
- [x] 1.2 Obtener D separado para el incremento exacto y, antes de instalar, permiso para paquete/versión del spike. Better Auth sigue provisional; no fijar ni sustituir biblioteca sin evidencia.
- [x] 1.3 Ensayar con datos sintéticos compatibilidad de biblioteca: Worker, cookies/CSRF, verificación/recuperación, UUID, PostgreSQL/Hyperdrive, sesiones y revocación. Distinguir local, simulado y remoto; detener ante incompatibilidad. Ningún ensayo remoto o credencial se deduce de C.

## 2. Primera vertical local recomendada

- [x] 2.1 Definir contratos Zod/OpenAPI de acceso, usuario actual, cierre y errores; puertos de identidad, sesión, correo, repositorio, reloj y auditoría. Probar UUID, exclusión de secretos y rechazo de roles/UUID seleccionados por cliente.
- [x] 2.2 Preparar migración aditiva 0005 con esquema revisado y ACL mínimas, sin cambiar 0001–0004 ni actores históricos. Probar en PostgreSQL efímero unicidad de identidad/correo, concesiones no editables por runtime, sesión/verificación y fallo atómico. No ejecutar migraciones en bases existentes sin permiso.
- [x] 2.3 Implementar cuentas sintéticas preautorizadas, correo fake explícito y credencial gestionada por biblioteca. Probar login válido/inválido, cuenta sin verificar, token consumido/expirado, recuperación y límites de intentos; fake prohibido en producción.
- [x] 2.4 Implementar sesión persistente/me/logout con cookies y configuración aprobadas. Probar fijación/rotación, recarga y límite absoluto de 8 horas sin renovación, usuario deshabilitado, rol retirado y reutilización tras logout; distinguir revocación no confirmada por fallo de transporte.
- [x] 2.5 Componer middleware de sesión y proteger las rutas privadas existentes, conservando permisos de recurso. Probar bypass con X-Dev/Access/rol del cliente, acceso horizontal, docente no asignado, CSRF/origen y no-store; dev/fakes solo por modo explícito sin fallback.
- [x] 2.6 Integrar pantalla de acceso y gate React sin credenciales duraderas en almacenamiento web. Ejecutar E2E sintético nuevo: verificar correo → entrar → me → aplicación protegida → recargar → cerrar → denegar sesión anterior y URL privada directa. Cubrir estados de carga, error, teclado y expiración; no repetir el recorrido completo de persistencia aprobado.

## 3. Federación y vinculación en el mismo cambio

- [ ] 3.1 Implementar adaptador Google mediante biblioteca y proveedor fake para tests: firma/iss/aud/vigencia, state/nonce/PKCE, dominio verificado y callback exacto. Probar token ajeno/repetido, retorno abierto y correo/hd sin concesión docente.
- [ ] 3.2 Implementar mapeo issuer/subject a UUID y vinculación con sesión/reautenticación. Probar email coincidente sin unión, cambio de correo sin cambio de UUID, carrera entre dos UUID y rollback de vinculación fallida.
- [ ] 3.3 Solo con acceso autorizado, configurar cliente/callback y correo real con credenciales mínimas por entrada segura; verificar cuenta institucional real y ambas vías. Sin ello mantener pendiente aceptación institucional, sin bloquear pruebas sintéticas ni declarar éxito remoto.

## 4. Verificación y salida

- [x] 4.1 Ejecutar solo controles y regresiones afectados: contratos, identidad/CSRF, nueva integración SQL, E2E de acceso, lint, tipos, formato y build; conservar los jobs CI aprobados. Ampliar regresión de persistencia únicamente si un cambio concreto la afecta.
- [x] 4.2 Validar este cambio y OpenSpec global, registrar evidencia por escenario y documentar configuración/operación segura. No marcar tareas de implementación sin salida real exitosa ni cerrar pendientes ajenos de EPIC-002.
- [ ] 4.3 Presentar resultado y riesgos para revisión humana. Git de escritura, PR, merge, despliegue y archivo/sincronización OpenSpec requieren autorizaciones propias; no están incluidos en esta propuesta.

## S. Spike local autorizado y verificado

- [x] S.1 Instalar Better Auth 1.7.14 y Kysely 0.29.7 exactos en este worktree; registrar 19 entradas nuevas y cero cambios de versión en paquetes existentes.
- [x] S.2 Preparar cluster exclusivo, roles separados y provisión sintética administrativa; aplicar el catálogo privado con el migrador existente, sin tocar bases preexistentes ni catálogo canónico. Conservar diagnóstico y resultados transaccionales separados.
- [x] S.3 Ejecutar 14 comprobaciones reales de HTTP, SQL y Chrome aislado: login, usuario UUID/rol, API de proyectos, recarga, logout, sesión revocada/expirada, cookies y rechazo de elevación de rol.
- [x] S.4 Verificar lint global, tipos del spike y builds locales de React/Worker; detener cluster y procesos del spike, manteniendo credenciales sintéticas únicamente en estado ignorado.

Resultado y alcance: [informe](../../../evidence/identity-access-spike/README.md). La autorización D y la evidencia de esta sección se limitan al spike. Las tareas 1.2–4.3 no se completan por esta demostración: el flujo definitivo, recuperación, fronteras de límites, vinculación, Google, correo real y Hyperdrive remoto conservan sus verificaciones pendientes. No hay archivo ni sincronización de specs canónicas.
