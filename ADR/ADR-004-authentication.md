# ADR-004: Autenticación institucional por dos vías

- Estado: Aceptado sujeto a spike.
- Fecha: 2026-10-08.

## Decisión
Ofrecer Google OAuth institucional y una alternativa de correo/contraseña con verificación por correo. Aplicar control de dominio, identidad verificada, RBAC y permisos por proyecto.

## Consecuencias
Se necesita configurar Google OAuth, callbacks, secretos y proveedor de correo. La biblioteca de autenticación se elige solo después de probar compatibilidad con Workers. El dominio `unsch.edu.pe` es la política inicial, pero debe comprobarse con una cuenta real.
