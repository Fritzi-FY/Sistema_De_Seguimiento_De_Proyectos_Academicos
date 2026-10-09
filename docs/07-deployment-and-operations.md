# 7. Despliegue, CI/CD, caché y operación

## 7.1 Ambientes

- **Local:** desarrollo y pruebas rápidas; secretos ficticios; PostgreSQL local/aislado.
- **Preview/PR:** despliegue de revisión cuando sea viable; no debe usar datos reales de producción.
- **Staging:** Worker y base de datos separados o un entorno aislado equivalente; destinado a E2E y pruebas de carga.
- **Producción:** Worker/Static Assets, variables y secretos productivos; solo despliegue desde `main` tras CI.

No ejecutar pruebas de carga contra producción. En producción se harán smoke checks de bajo volumen.

## 7.2 Cloudflare

- Workers sirve la API y puede servir los assets del frontend; usar un dominio `workers.dev` para la primera prueba y conectar un dominio propio si está disponible.
- Configurar DNS, HTTPS/TLS y redirección HTTP→HTTPS cuando corresponda.
- Activar las protecciones disponibles en el plan real; no documentar una función como activa hasta comprobarla en el dashboard.
- Usar Hyperdrive para la conexión de Workers a PostgreSQL y controlar el límite de conexiones del cliente.
- Mantener variables públicas y secretos separados; `OPENROUTER_API_KEY`, OAuth client secret, secretos de sesión y credenciales de base de datos solo como secretos.
- Configurar ambientes con `wrangler` y evitar que un despliegue de preview escriba en producción.

## 7.3 PostgreSQL

Neon se propone como candidato inicial de nivel gratuito, no como obligación irreversible. Antes de seleccionarlo definitivamente comprobar: conectividad desde Hyperdrive, requisitos de IP/TLS, límites del plan gratuito, pausas por inactividad, tamaño, backups, región y políticas de conexión. La base de datos es un servicio externo a Cloudflare y sus límites/costos se evalúan por separado.

## 7.4 Pipeline CI/CD

### En pull request

1. Instalar dependencias desde lockfile.
2. Lint y formato.
3. Typecheck.
4. Tests unitarios.
5. Tests de integración con DB aislada.
6. Validación de contrato/OpenAPI.
7. Build.
8. Escaneo de dependencias/secretos.
9. Resumen del estado y bloqueo de merge si hay fallas.

### En `main`

1. Repetir verificaciones obligatorias.
2. Ejecutar migración compatible de base de datos con control explícito.
3. Desplegar con Wrangler usando secretos de GitHub Actions/Cloudflare.
4. Ejecutar smoke test de `/health` y un endpoint seguro de lectura.
5. Registrar versión, commit y fecha.
6. Tener procedimiento de rollback a versión anterior y migraciones compatibles.

La migración automática debe diseñarse con cuidado: evitar cambios destructivos y comprobar que el código anterior y el nuevo puedan convivir durante el despliegue.

## 7.5 CI no es CDN

- **CI:** automatiza validaciones y pruebas de código.
- **CD:** automatiza publicación de una versión validada.
- **CDN:** distribuye y cachea recursos estáticos en el borde.
- **Observabilidad:** aporta métricas, logs, trazas/correlation IDs y alertas.

## 7.6 Observabilidad

- Endpoint de salud que no exponga secretos ni detalles internos.
- Logs estructurados con request/correlation ID.
- Métricas de latencia, tasa de errores, volumen, uso de IA y fallas de dependencias.
- Cloudflare Workers Analytics/Logs disponibles según plan y configuración; complementar con GitHub deployment history.
- No registrar tokens, cookies, contraseñas, cadenas de conexión ni prompts completos por defecto.
- Crear un procedimiento de diagnóstico para errores 5xx, límites de Worker, errores de DB y respuestas 429/5xx de OpenRouter.

## 7.7 Costos y límites

- Mantener el objetivo de gasto mensual en US$0–10, pero no prometer costo cero permanente.
- Configurar cuotas de IA y alertas de consumo; no hacer llamadas de IA durante CI.
- Verificar límites actualizados de Workers, Hyperdrive, proveedor PostgreSQL y correo antes del lanzamiento.
- No contratar un plan de pago automáticamente. Si una cuota se alcanza, degradar función no crítica, documentar el límite y solicitar decisión antes de gastar.

## 7.8 SSL y dominio

- Usar HTTPS para todos los ambientes publicados.
- Configurar redirect URI exacto de Google OAuth para cada ambiente.
- No activar HSTS de larga duración hasta validar que todos los subdominios y flujos HTTPS funcionan.
- Comprobar certificado, redirecciones, cookies seguras y mixed content tras desplegar.
