# 1. Visión y alcance del producto

## 1.1 Problema

El seguimiento de proyectos académicos suele distribuirse entre mensajes, documentos y hojas de cálculo. Esto dificulta conocer el estado real de las tareas, la responsabilidad de cada integrante, las fechas límite, las observaciones docentes y el historial de decisiones.

## 1.2 Visión

Proveer una plataforma web que centralice la organización, ejecución y seguimiento de proyectos académicos, facilitando la coordinación entre estudiantes y docentes y manteniendo trazabilidad de tareas, avances, revisiones y entregables.

## 1.3 Objetivos

1. Centralizar proyectos, equipos, tableros, tareas, avances y entregables.
2. Hacer visible el progreso y los riesgos sin depender de mensajes dispersos.
3. Facilitar la revisión docente y el registro de observaciones.
4. Permitir personalización del flujo de trabajo por proyecto.
5. Registrar operaciones relevantes para auditoría y sustentación académica.
6. Incorporar IA como asistente de productividad, no como calificador automático.
7. Demostrar arquitectura, calidad, seguridad, SDD, CI/CD, despliegue y pruebas de carga.

## 1.4 Actores y permisos de alto nivel

- **Estudiante:** crea o integra equipos según las reglas del proyecto, gestiona tareas permitidas, registra avances y consulta comentarios.
- **Docente:** supervisa los proyectos asignados, comenta avances, revisa entregables y visualiza reportes de su ámbito.
- **Administrador:** gestiona usuarios/roles institucionales, cursos y configuración general. No se permitirá que un usuario se otorgue a sí mismo privilegios de docente o administrador.
- **Proveedor de identidad:** Google OAuth, sujeto a configuración y validación de correo institucional.
- **Proveedor de IA:** OpenRouter, encapsulado detrás de un puerto interno.
- **Operación:** GitHub Actions y Cloudflare para validación, despliegue y métricas.

## 1.5 Alcance funcional objetivo

- Autenticación y gestión de perfil/roles.
- Cursos, proyectos, equipos y membresías.
- Tableros por proyecto con columnas configurables.
- Tareas con título, descripción, estado/columna, prioridad, responsable(s), fechas, etiquetas y orden.
- Comentarios y actividad de tareas.
- Registro de avances y evidencias mediante metadatos/enlaces.
- Entregables y revisiones docentes con observaciones.
- Notificaciones internas y avisos de fechas/observaciones.
- Historial de actividad y auditoría.
- Reportes de progreso por proyecto, equipo, curso y estado.
- Asistente IA para resumir avances, detectar riesgos potenciales y sugerir próximos pasos.
- Diseño responsive y accesible, con vistas Kanban y lista.

## 1.6 Entrega temprana

El alcance completo es la meta, pero la primera entrega funcional será un **flujo vertical**: autenticación, creación de proyecto, tablero, creación/movimiento de tarea y persistencia en PostgreSQL. Se expandirá después por módulos.

## 1.7 Fuera de alcance inicial

- Sistema LMS completo, matrícula, notas oficiales o integración con intranet universitaria.
- Calificación automática por IA.
- Chat/video en tiempo real.
- Aplicaciones móviles nativas.
- Almacenamiento masivo de archivos. En primera versión se guardarán metadatos y enlaces; los adjuntos binarios se evaluarán más adelante con almacenamiento de objetos como R2.
- Microservicios independientes, Kubernetes o infraestructura compleja sin evidencia de necesidad.
- Garantía de disponibilidad empresarial sobre servicios gratuitos.

## 1.8 Principios de producto

- El tablero es una herramienta de organización académica, no un sistema oficial de calificaciones.
- El acceso a cada proyecto se valida en el servidor en cada operación.
- La personalización debe tener límites razonables y no permitir que el usuario rompa el modelo de datos.
- La IA es asistiva, explicable en cuanto a los datos usados y no debe ser una fuente de verdad.
- El sistema debe ser utilizable sin IA si el proveedor está caído o se agotó la cuota.
