# 5. Seguridad, autenticación y privacidad

## 5.1 Identidad institucional

La aplicación admitirá dos vías:

1. **Google OAuth:** permitir el acceso solo si el proveedor confirma identidad verificada y el correo cumple la política institucional. La restricción por dominio debe validarse en backend; no basta con ocultar opciones en la UI.
2. **Correo/contraseña con verificación:** utilizar una biblioteca madura y un proveedor de correo transaccional configurado. La creación de cuenta no concede automáticamente rol de docente/administrador.

El dominio `unsch.edu.pe` se usará como dominio permitido propuesto. La configuración real de Google Workspace, consentimiento OAuth, URL de callback y política institucional debe verificarse con una cuenta real antes de declarar autenticación institucional completada. El dominio del correo no demuestra por sí solo que se disponga de SSO universitario administrado.

## 5.2 Autorización

- Aplicar RBAC global (estudiante/docente/administrador) y autorización contextual por proyecto/curso.
- Validar permisos en cada caso de uso del servidor.
- Denegar por defecto y aplicar mínimo privilegio.
- No confiar en IDs, roles o estado enviados por el cliente.
- No permitir que un estudiante se asigne el rol de docente ni que un docente se vuelva administrador.
- Cubrir pruebas de acceso horizontal: un usuario no puede consultar/editar proyecto, tarea, comentario, entregable o reporte de otro proyecto sin permiso.

## 5.3 Sesiones y credenciales

- Preferir cookies seguras `HttpOnly`, `Secure` y `SameSite` cuando la biblioteca lo permita y el frontend/backend compartan origen; revisar protección CSRF según mecanismo.
- No guardar tokens de sesión duraderos en `localStorage`.
- Rotar secretos y mantenerlos en secretos de Cloudflare/GitHub, nunca en el repositorio.
- Usar OAuth state/nonce y PKCE cuando aplique.
- Aplicar límites de intentos, mensajes de error que no revelen si una cuenta existe y recuperación segura.

## 5.4 IA y OpenRouter

- `AIProvider` es un puerto interno; el adaptador OpenRouter es reemplazable.
- Enviar solo los datos mínimos del proyecto que el usuario puede ver.
- No enviar contraseñas, tokens, secretos, correos privados innecesarios ni información de otros proyectos.
- No usar IA para calificar, sancionar o tomar decisiones académicas finales.
- Mostrar que el contenido es una sugerencia generada por IA y permitir al usuario descartarlo.
- Configurar límite por usuario/proyecto, timeout, tamaño máximo de entrada y salida, máximo de reintentos y modelo permitido.
- No reintentar errores no recuperables ni crear bucles de gasto.
- Registrar metadatos de uso y errores; no guardar prompts/respuestas completos salvo necesidad aprobada y con política de retención.
- Pruebas automáticas usarán `FakeAIProvider` o `MockAIProvider`; CI no debe consumir tokens reales.
- Si OpenRouter falla, la plataforma sigue funcionando para operaciones principales.

## 5.5 Auditoría

Registrar actor, acción, recurso, fecha/hora, resultado y correlation ID para cambios sensibles. No incluir tokens, contraseñas, cookies ni cuerpos completos de requests en logs. Restringir quién consulta auditoría y evitar edición desde el flujo de usuario común.

## 5.6 Protección de API y datos

- Validación de entradas con esquemas y límites de tamaño.
- Consultas parametrizadas mediante ORM/driver seguro.
- CORS limitado a orígenes esperados; no usar `*` con credenciales.
- Rate limiting para autenticación, IA y endpoints costosos.
- Headers de seguridad adecuados; HTTPS obligatorio.
- Respuestas privadas con caché compartida deshabilitada por defecto.
- Revisar dependencias y ejecutar auditoría de vulnerabilidades en CI.
- Copias de seguridad y retención dependen del proveedor PostgreSQL seleccionado; no declarar recuperación garantizada hasta probarla.

## 5.7 Privacidad y datos académicos

- Recopilar solo datos necesarios para el seguimiento de proyectos.
- Documentar finalidad y retención de comentarios, auditoría y datos de IA.
- Evitar publicar datos de estudiantes en páginas públicas o índices de búsqueda.
- Eliminar o anonimizar datos de prueba antes de las demostraciones públicas.
- No utilizar datos reales sensibles en pruebas de carga.
