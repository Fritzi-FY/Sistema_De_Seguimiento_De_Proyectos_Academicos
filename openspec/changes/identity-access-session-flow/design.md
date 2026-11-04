## Context

Base: `origin/main` actualizado a `f42dc0dd9dd9a2b3cb9189c8d4334c54937c6896`, rama `feature/identity-access`, worktree separado. Fuentes: [identity-access canónico](../../specs/identity-access/spec.md), [ADR-004](../../../ADR/ADR-004-authentication.md), [arquitectura](../../../docs/03-architecture.md), [seguridad](../../../docs/05-security-and-privacy.md), [modelo](../../../docs/04-data-model.md) y [estrategia de pruebas](../../../docs/06-test-strategy.md).

Hoy `AuthMiddleware` es inyectable, `dev-auth` acepta cabeceras solo en desarrollo/test y Access representa cinco actores sintéticos. El frontend dispone de `DEV_IDENTITIES`. Ninguno constituye sesión de usuario del producto. Los puertos de proyectos/Kanban y la fuente de asignación docente se reutilizan; autenticación no amplía permisos por proyecto.

## Goals / Non-Goals

Completar ingreso, usuario actual, continuidad y salida para ambas vías, separando identidad de autorización. El primer incremento demostrable será local y sintético; la aceptación federada y correo real necesitan sus propias pruebas.

Fuera de alcance: administración completa de usuarios/roles, autoasignación docente, matrícula institucional, importación de identidades históricas, MFA, múltiples organizaciones, “recordarme”, despliegue, archivo OpenSpec y repetición de suites de persistencia ya aprobadas. La recuperación de contraseña se mantiene en el diseño de la vía local, con el mecanismo de la biblioteca; no se ofrece un procedimiento manual inseguro.

## Decisions

### 1. Confirmado y provisional

Confirmado: dos vías según ADR-004 y Constitución; UUID público interno; roles y permisos comprobados en servidor; PostgreSQL con migrador versionado; sesiones sin estado autoritativo en memoria global; cookies `HttpOnly`, `Secure`, `SameSite`; ausencia de tokens duraderos en `localStorage`.

Aprobado por el usuario: cuentas sintéticas preautorizadas por herramienta local, solo correos provisionados, sin registro público; autoridad administrativa explícita del servidor para roles. Sesión máxima de 8 horas, revocable al cerrar, sin “recordarme” ni renovación del plazo absoluto. No se incorpora una política adicional de inactividad. El spike local demostró Better Auth 1.7.14 y Kysely 0.29.7 en workerd/PostgreSQL; la compatibilidad remota sigue pendiente. SPA/API del spike comparten origen HTTPS. No se confunde autenticación local con cabeceras dev.

### 2. Identidades y roles

Modelo lógico, cuyo DDL depende del spike:

| Registro              | Invariante                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuario de aplicación | UUID generado por servidor, correo normalizado único y verificado, estado controlado por servidor.                                                        |
| Identidad externa     | Clave única `(provider, issuer, subject)` ligada a un UUID interno; `subject` no se transforma ni se sustituye por email.                                 |
| Credencial local      | Gestionada por la biblioteca madura y ligada al mismo usuario; sin contraseñas en claro ni hashing casero.                                                |
| Concesión de rol      | Registro separado del perfil editable, con actor y evidencia de concesión; runtime ordinario sin permiso de elevar roles.                                 |
| Sesión/verificación   | Modelo revisado de la biblioteca, expiración y revocación autoritativas en servidor; tokens y credenciales nunca aparecen en respuestas de perfil o logs. |

Google se valida en backend: firma, emisor permitido, audiencia, vigencia, nonce/state y PKCE mediante biblioteca, correo verificado y política institucional. `hd` no concede roles ni sustituye la autorización; si se exige pertenencia a Workspace, se valida ese claim y no solo el sufijo del email. Referencia primaria: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect). Google distingue `sub` estable de un correo que puede cambiar; el adaptador normaliza únicamente los emisores Google expresamente permitidos.

El correo es contacto/elegibilidad, no clave de unión de proveedores. Un cambio de correo del proveedor no cambia el UUID ni reasigna recursos; la actualización del contacto principal requiere verificación y unicidad. No se aplican equivalencias de puntos o alias de Gmail para fusionar usuarios.

Un login externo ya vinculado recupera su UUID y rol autorizado. Una identidad desconocida no obtiene sesión de producto hasta completar la política de alta aprobada; en el primer incremento se exige la provisión controlada aprobada. Dominio, `hd`, nombre, rol de un token externo, cabeceras y cuerpo de request jamás conceden `teacher`/`admin`. Ser propietario de proyecto tampoco concede un rol global. La asignación docente por proyecto sigue siendo otra relación.

La vinculación requiere sesión vigente del usuario destino, reautenticación de la vía actual y prueba fresca de la nueva identidad. Transacción y unicidad impiden vincular la misma identidad a dos UUID. Igual email sin esa prueba no fusiona cuentas; se da una respuesta controlada sin revelar otra cuenta. El desvinculado y cambio de correo no se añaden a la primera vertical.

### 3. Flujo y contratos propuestos

| Entrada                                                              | Resultado                                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/sign-in/email`                                       | Verifica credencial, elegibilidad, estado y correo; rota sesión antes de emitir cookie. Error genérico para credencial/cuenta no válida.                               |
| `POST /api/auth/verification/request` y confirmación de verificación | Camino controlado de verificación para cuentas habilitadas; token acotado y de un uso. El GET de un enlace solo presenta confirmación, sin consumirlo por un prefetch. |
| Inicio/callback Google bajo `/api/auth/`                             | Redirección y callback validados; URI exacta y destino de retorno local permitido; nunca aceptar redirección arbitraria.                                               |
| `GET /api/auth/me`                                                   | UUID, perfil mínimo y rol autorizado; `401` sin sesión; sin secretos y `Cache-Control: private, no-store`.                                                             |
| `POST /api/auth/sign-out`                                            | Revoca sesión y expira cookie; idempotente. Solo anuncia cierre confirmado tras respuesta válida.                                                                      |
| Vinculación bajo `/api/auth/identities/`                             | Sesión y reautenticación obligatorias; nunca aceptar un UUID destino elegido por cliente.                                                                              |

Son contratos de aplicación a formalizar con Zod/OpenAPI, no promesas sobre rutas nativas de una biblioteca aún no elegida. La recuperación usa tokens de un uso y vencimiento; al confirmar un cambio de contraseña revoca las sesiones previas. El correo fake existe solo en test/desarrollo explícitos y nunca sirve como aceptación de entrega real.

### 4. Sesión y protección

Cookie con alcance mínimo, sin dominio amplio, `HttpOnly`, `Secure`, `SameSite=Lax` como propuesta para retorno OAuth y prefijo `__Host-` donde corresponda. El desarrollo usará HTTPS local para verificar flags reales; no se relajan flags productivos ni se instala un certificado en esta fase.

Servidor comprueba sesión, estado y rol vigente en cada operación protegida; lectura consistente tras revocación, sin caché compartida o cookie de roles autoritativa. El primer incremento no renueva automáticamente la sesión ni extiende su vencimiento absoluto de 8 horas. Deshabilitar usuario o cambiar rol invalida privilegios en nuevas solicitudes sin conservar roles obsoletos. No se promete cancelar retroactivamente una escritura ya autorizada en vuelo.

Origin/CSRF de la biblioteca en mutaciones, incluyendo login/logout/vinculación; `SameSite` solo no basta. Callback usa state/nonce de un uso y expiración. CORS, si llega a necesitarse, usa orígenes exactos con credenciales, nunca `*`. Errores no enumeran cuentas; intentos y verificación tienen límites por cuenta/origen, plazos y pruebas de frontera según configuración revisada. No se reintentan automáticamente mutaciones por un `401` o un fallo de transporte.

En modo sesión, rechazar cabeceras `X-Dev-*` como autoridad y no aceptar service tokens Access como usuarios. Mantener adaptadores fake/dev como elección explícita de test/desarrollo, incompatibles con la composición productiva de sesión. Una configuración incompleta falla cerrada. Salud técnica mínima y rutas de acceso expresamente permitidas no exponen datos de usuario; el resto de la API requiere sesión y permisos de recurso.

Frontend inicia en estado de comprobación de sesión, sin pintar datos privados antes de `me`. Sin sesión muestra acceso; ante `401` elimina datos privados en memoria y vuelve a acceso, sin convertir errores de transporte en “sesión válida” ni enviar cabeceras dev. Recarga consulta `me`; logout confirmado vacía cachés de usuario. Un fallo de logout muestra estado no confirmado y no afirma revocación. No persiste tokens en almacenamiento web.

### 5. Puertos y archivos previstos

- Dominio/aplicación: usuario/identidad/rol/sesión y casos de uso de entrar, verificar, recuperar, obtener usuario, vincular y cerrar. Dependencia solo de puertos de identidad, sesión, repositorio, correo, reloj y auditoría.
- `packages/shared/src/contracts/identity-access.contract.ts` y puertos de identidad/sesión: DTO mínimos, UUID y roles enumerados; adaptador al `AuthUserContext` existente.
- `apps/api/src/application/use-cases/` y `apps/api/src/infrastructure/auth/`: biblioteca encapsulada, Google y correo, fakes identificados.
- `apps/api/src/infrastructure/http/`: router de acceso, middleware de sesión, composición y contrato OpenAPI. Se reutilizan los casos de uso de producto sin mover sus reglas al frontend.
- `apps/api/migrations/sql/0005_identity_access.sql`, manifiesto y ACL versionadas: nombres físicos por revisar con el spike; migración manual/aditiva y privilegios mínimos. No SQL de arranque ni modificación de 0001–0004.
- `apps/web/src/`: acceso, comprobación/estado de sesión y cliente API común; sustitución del selector dev solo en modo autenticado.
- Pruebas de identidad/cookies/CSRF, SQL del nuevo esquema y un E2E de acceso. La infraestructura CI SQL existente se reutiliza si cubre el nuevo objetivo; no se reproduce el recorrido de persistencia aprobado sin un cambio que lo afecte.

Los UUID de actores históricos de proyectos/tareas no se reescriben ni se unen por correo. No se imponen FKs nuevas a datos históricos sin inventario y autorización. Para fixtures sintéticos se vinculan explícitamente los UUID de prueba; adoptar cuentas o datos reales requiere un paso separado aprobado.

### 6. Spike y orden de entrega

1. Verificar biblioteca/versiones sin promoción anticipada: compilación Workers, API de cookies y rutas, hashes y verificación/recuperación, UUID/adaptación del esquema, roles separados, PostgreSQL/Hyperdrive, sesiones y CSRF. Ensayo local sintético primero; cualquier instalación o validación remota necesita su autorización propia.
2. Vertical local preautorizada: verificación, credencial, sesión/me/logout y protección integral API/frontend; integración SQL y navegador con proveedor fake de correo explícito.
3. Google y vinculación: tests con proveedor fake; aceptación institucional real solo con cliente/callback y cuenta real autorizados. La contingencia local sigue disponible con correo configurado.

Si el spike falla, detenerse y comunicar la incompatibilidad; no escribir un sistema casero ni sustituir silenciosamente proveedores. Ausencia de proveedor de correo real no habilita cuentas sin verificar. Los demás pendientes del PR #5 (E2E general, recuperación operativa y aceptación remota) no se cierran por este cambio.

## Risks / Trade-offs

La provisión controlada aprobada reduce el alcance inicial: únicamente el operador administrativo concede altas y roles a los correos provisionados. La vinculación explícita añade un paso y evita tomar cuentas por compartir correo. Consultar estado/roles en servidor evita privilegios obsoletos y debe medirse antes de introducir caché. Un fake valida contratos, no entrega de correo ni política institucional de Google.

## Decisiones y credenciales indispensables

Las decisiones aprobadas y las credenciales por etapa están enumeradas en [proposal.md](proposal.md). El spike utilizó un cluster exclusivo nuevo en 127.0.0.1:55510, base is488_auth_spike, con roles sintéticos separados. No utilizó is488_dev ni bases preexistentes. No necesita credenciales Google/correo real. No se recopilan contraseñas institucionales. No se añaden decisiones sobre hosting, IA, Kanban o planes comerciales.

## Resultado técnico local

Evidencia: [informe](../../../evidence/identity-access-spike/README.md), [14 escenarios](../../../evidence/identity-access-spike/results.json), [versiones](../../../evidence/identity-access-spike/dependencies.json) y [transacciones](../../../evidence/identity-access-spike/migrations.json).

Se generó DDL fuera del Worker y se aplicó mediante el migrador existente en un catálogo privado del spike: 0001–0004 intactas y 0005 exclusiva de prueba. El catálogo canónico no cambió. El DDL usa public explícito y omite únicamente el CREATE SCHEMA redundante no admitido por el migrador. La concesión de roles es una tabla separada, de solo lectura para runtime.

Better Auth 1.7.14 asigna 24 horas por defecto cuando rememberMe=false; el adaptador fija esa opción y limita expiresAt en el hook del servidor a createdAt + 8 horas. Cookie sin MaxAge, renovación y cookieCache deshabilitados. Se espera la validación de esquema y la respuesta HTTP antes de cerrar el pool por request. El DTO de aplicación no expone el token devuelto por la ruta nativa de login.

La pantalla React aislada probó la API real de proyectos con el middleware inyectado. El frontend de producto conserva DEV_IDENTITIES; todavía requiere integración definitiva, contratos Zod/OpenAPI, CSRF integral de mutaciones y las pruebas pendientes de la sección 2. Google y la vinculación no se implementaron. No se construyó autenticación propia ni se promovió Better Auth a decisión definitiva para producción.
