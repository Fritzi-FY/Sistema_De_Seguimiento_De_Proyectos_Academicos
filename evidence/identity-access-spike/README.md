# Spike local de autenticación

Better Auth **1.7.14**, con Kysely **0.29.7**, encaja para continuar el primer flujo local. Pasaron **14/14 comprobaciones** sobre PostgreSQL 18.6, workerd local mediante Wrangler 4.149.0 y Chrome headless real con perfil exclusivo. La ejecución terminó el 31/10/2026 a las 02:02:55 UTC (30/10 a las 21:02:55 de Lima). Esto acredita el spike, no aceptación remota ni autenticación institucional.

## Evidencia y alcance demostrado

[Escenarios ejecutados](results.json), [versiones](dependencies.json), [resultados transaccionales y tiempos](migrations.json), [DDL aplicado al spike](schema-reviewed.sql). El código está en [apps/api/spikes/identity-access](../../apps/api/spikes/identity-access/).

Se verificaron rechazo anónimo de API/página, denegación antes de verificar correo, verificación con buzón sintético y registro público deshabilitado. Login devuelve UUID interno y rol del servidor, sin token en el DTO. Sesión de hasta 28 800 segundos sin renovación ni recordarme, y rechazo de sesión expirada. Intentos de autoasignación por cuerpo HTTP, edición de perfil y SQL del runtime fallaron; DDL del runtime también se denegó. Origin ajeno no pudo cerrar la sesión, y X-Dev no sustituyó su autoridad.

Chrome completó formulario → aplicación React protegida → API real de proyectos → recarga efectiva con el mismo UUID → logout. Se comprobaron cookie Secure/HttpOnly/SameSite=Lax de sesión, ausencia de token en localStorage y denegación de la cookie revocada tanto en me/API como en la página privada. La API de producto se reutilizó mediante su AuthMiddleware existente; la pantalla es un fixture React aislado, no integración definitiva del frontend actual.

## Adaptaciones necesarias

1. Generación del esquema fuera del Worker y aplicación con el migrador vigente. Esquema public explícito; se excluye solo el CREATE SCHEMA redundante generado por la biblioteca, conservando intactas 0001–0004 y el catálogo canónico. La 0005 aplicada pertenece únicamente al catálogo privado del spike.
2. Better Auth 1.7.14 da 24 horas cuando rememberMe=false. El adaptador impone false y limita expiresAt a createdAt + 8 horas mediante hook del servidor; deshabilita renovación y cookieCache. La opción enviada por el cliente no modifica el plazo ni hace persistente la cookie.
3. Se esperan checkSchema y las respuestas HTTP antes de pool.end. Cerrar el pool al devolver una promesa sin await produjo un 500 en la integración inicial; corregir el ciclo de vida permitió pasar el recorrido. No se relajó la validación de esquema.
4. Roles separados del perfil editable, concedidos por operador administrativo; runtime solo puede leerlos. Login nativo se adapta para retirar el token del JSON público. No hay inferencia de rol por dominio ni unión automática por email.

El primer DDL no cualificado falló en migration_sql, DatabaseError/SQLSTATE 42501, con rollback y cierre confirmados. Otro catálogo fue rechazado antes de iniciar transacciones por CREATE SCHEMA no admitido. Se conservaron esos intentos, sin ampliar privilegios ni reintentar COMMIT incierto. El catálogo final confirmó COMMIT de las cinco migraciones y cierre; los tiempos originales están separados en migrations.json.

## Reproducción y controles

Desde C:/Users/fritz/IS488-identity-access, con Node 24.18.0, PostgreSQL 18 local, Chrome y OpenSSL ya disponibles:

```powershell
node apps/api/spikes/identity-access/prepare.mjs
node node_modules/vite/bin/vite.js build --config apps/api/spikes/identity-access/vite.config.ts
node apps/api/spikes/identity-access/verify.mjs
```

Preparación y verificación son un ensayo sobre fixtures iniciales: prepare no reinicia automáticamente un estado existente; verify consume la verificación de correo y modifica sus sesiones. No debe repetirse sobre el estado ya consumido esperando fixtures nuevos. Los intentos incompletos se conservan para diagnóstico; no hay reseteo automático ni reutilización de otra base.

Destino exclusivo: 127.0.0.1:55510/is488_auth_spike, con admin, migrator y runtime propios. No se tocó is488_dev ni proyectos remotos. Credenciales sintéticas, certificado/clave local, logs, builds y cluster quedan en .local-dev/auth-spike, ignorado por Git; no forman parte de esta evidencia. No se instaló confianza de certificados en Windows ni se usó un perfil personal del navegador.

Controles finales aprobados: npm run lint global; tsc estricto sobre auth.ts, worker.ts, client.tsx y vite.config.ts; build Vite (29 módulos); bundle Worker con wrangler deploy --dry-run (sin publicación). La salida Worker fue 3032.75 KiB, 501.74 KiB gzip; no se deduce de ello aceptación de cuotas remotas. No se repitieron suites aprobadas de persistencia. Se confirmó PostgreSQL detenido y ausencia de listeners 55510/8791/9291 o Chrome del perfil del spike.

## Alcance concreto para el flujo definitivo

- Formalizar puertos y contratos Zod/OpenAPI de identidad, sesión, provisión y correo; encapsular Better Auth en adaptadores y mantener roles únicamente en servidor.
- Incorporar DDL revisado, manifiesto y ACL como migración aditiva canónica, con pruebas SQL focalizadas. La base de desarrollo existente no recibió esta migración del spike.
- Endurecer la herramienta de provisión administrativa, mantener solo emails autorizados y sin registro público; cubrir verificaciones repetidas/expiradas, recuperación, límites y cambios de estado/rol.
- Integrar el frontend actual y su cliente API: sustituir DEV_IDENTITIES en modo sesión, proteger rutas, manejar expiración y logout incierto, limpiar datos de usuario y aplicar CSRF integral a las mutaciones privadas.
- Añadir pruebas repetibles de contrato, SQL y navegador al mecanismo CI existente. Preparar Google mediante proveedor fake y vinculación explícita issuer/subject → UUID, sin unión por email.

Google real, correo real, vinculación federada, Hyperdrive remoto y medición de CPU/cuotas Workers no se ensayaron. No se solicitan sus credenciales todavía. Recuperación de contraseña y fronteras del rate limit tampoco se declaran verificadas. El resultado local es favorable con estas adaptaciones, sin construir autenticación propia; no promueve la biblioteca a decisión definitiva de producción.

La implementación definitiva requiere autorización propia. Permanecen los pendientes de EPIC-002: E2E general, recuperación operativa, autenticación institucional y aceptación remota. No hubo commits, push, despliegues, servicios de autenticación remotos ni ZIP.
