## Why

La API y el frontend aún identifican usuarios mediante cabeceras y UUID sintéticos. La persistencia integrada en `f42dc0d` no acredita autenticación institucional. Se necesita el primer recorrido real de acceso sin confiar en identidad o roles enviados por el navegador.

Esta propuesta conserva las dos vías obligatorias de ADR-004: Google OAuth institucional y correo/contraseña con verificación. Aporta un flujo demostrable de identidad, sesión y autorización, sin reabrir las verificaciones aprobadas de persistencia.

## What Changes

- Una identidad interna UUID, separada de credenciales y de identidades externas; roles concedidos exclusivamente por una fuente del servidor.
- Inicio de sesión local con correo verificado y entrada federada Google, sobre el mismo contrato de sesión, usuario actual y cierre.
- Vinculación explícita de identidades con prueba de control de ambas vías; ninguna unión por correo ni promoción por dominio.
- Sesión persistente validada en servidor, cookies seguras, expiración, revocación, protección CSRF y respuestas privadas sin caché compartida.
- Pantalla de acceso y barrera de sesión en React, sin identidad dev en el modo autenticado; protección real en todas las rutas privadas de API.
- Esquema aditivo mediante el migrador vigente, adaptadores de identidad/correo/sesión y pruebas focalizadas SQL, contrato y E2E de acceso.

### Primer incremento recomendado

Primero, una vertical local completa para cuentas preautorizadas de prueba: verificar correo con un buzón fake explícito de desarrollo, entrar con contraseña, consultar `GET /api/auth/me`, abrir la aplicación protegida, mantener la sesión al recargar y cerrarla con revocación confirmada. Incluye expiración, denegaciones y roles provenientes del servidor. Requiere antes un spike acotado de una biblioteca madura; Better Auth sigue siendo candidato, no decisión definitiva.

Después, dentro de este mismo cambio, conectar Google y la vinculación usando los mismos puertos y la misma sesión. El flujo local no se elimina al habilitar Google. Una demo sintética no se declara aceptación de correo real, Google UNSCH o Workers/Hyperdrive.

## Capabilities

### Modified Capabilities

- `identity-access`: identidad dual, sesión completa, UUID interno, concesión de roles y protección API/frontend.

## Impact

Cambios previstos en contratos/puertos compartidos, casos de uso de acceso, adaptadores HTTP/PostgreSQL/correo/proveedor, composición y frontend. Migración aditiva siguiente al catálogo 0001–0004; sin cambiar migraciones aplicadas, proyectos, membresías, tareas ni historia.

La autorización posterior permite exclusivamente el spike local sintético, instalar una versión estable exacta y sus dependencias indispensables en este worktree. Se ensayó Better Auth 1.7.14 con Kysely 0.29.7, sin actualizar versiones preexistentes. No autoriza el flujo definitivo, servicios externos, despliegue, Git de escritura ni archivo de OpenSpec. La especificación canónica permanece intacta. El nombre `feature/identity-access` es el solicitado expresamente por el usuario; los worktrees previos se preservan.

Costo: esta planificación no genera gasto. El incremento sintético puede usar herramientas ya disponibles y correo fake. Correo real, OAuth y validación remota quedan condicionados a credenciales, cuotas y autorización específica; no se promete US$0 de servicios aún no seleccionados.

## Decisiones confirmadas y resultado del spike

El usuario aprobó cuentas sintéticas preautorizadas mediante herramienta local, sin registro público; solo correos incluidos en esa provisión; roles concedidos por una autoridad administrativa explícita del servidor, sin autoasignación. Sesión máxima de 8 horas, revocable al cerrar, sin renovación del plazo absoluto ni “recordarme”. No se aprobó un timeout adicional de inactividad.

El [informe del spike](../../../evidence/identity-access-spike/README.md) registra 14 comprobaciones satisfactorias en PostgreSQL y workerd locales, con navegador Chrome real aislado. Better Auth encaja para continuar la vertical local con las adaptaciones documentadas; sigue sin constituir aceptación de Google, correo real o Hyperdrive remoto. La implementación definitiva requiere autorización propia; no necesita nuevas credenciales para continuar las pruebas sintéticas.

Credenciales solo cuando se ensayen proveedores reales: origen/callback exactos; cliente OAuth Google y secreto por entrada segura, más una cuenta institucional de prueba controlada por el usuario; proveedor de correo, remitente verificado y credencial limitada. El secreto de sesión se generará y custodiará al implementar. El primer ensayo sintético no necesita esas credenciales, una contraseña institucional, permisos amplios ni una base remota nueva.
