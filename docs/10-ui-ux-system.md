# 10. Sistema de diseño y UX

## 10.1 Dirección visual

Construir una interfaz de productividad moderna, pulida y configurable, inspirada en patrones conocidos de herramientas SaaS de proyectos, sin copiar marcas, ilustraciones o pantallas de Trello.

- Layout con navegación lateral colapsable, encabezado contextual y contenido principal amplio.
- Tablero Kanban con tarjetas legibles, columnas configurables, filtros y búsqueda.
- Panel de proyecto con progreso, fechas clave, miembros, actividad reciente y riesgos.
- Vistas Kanban y lista; calendarios o timeline solo si el tiempo lo permite.
- Estados vacíos diseñados, skeletons, mensajes de error útiles, confirmaciones para acciones destructivas y undo cuando sea viable.
- Responsive desde móvil a escritorio; navegación por teclado y foco visible.

## 10.2 Base recomendada

- `shadcn/ui` como base: componentes editables en el repositorio, sin depender de una caja negra de componentes.
- Tailwind CSS para tokens y composición.
- Radix UI para primitivas accesibles.
- Lucide para iconografía consistente.
- dnd-kit para arrastrar/soltar tareas.
- TanStack Table para vistas tabulares; Recharts solo para gráficos que aporten información.
- Opcional: Magic UI o Aceternity UI para componentes puntuales; revisar licencias, dependencias, rendimiento y accesibilidad. No añadir animaciones decorativas a todas las pantallas.

Repositorios oficiales:
- shadcn/ui: https://github.com/shadcn-ui/ui
- Aceternity UI: https://github.com/aceternity/ui
- Magic UI: https://github.com/magicuidesign/magicui

## 10.3 Personalización funcional

- Columnas de tablero configurables (nombre, orden y color; límites de cantidad razonables).
- Prioridades y etiquetas.
- Asignación de uno o varios responsables según reglas de negocio.
- Fechas límite y avisos.
- Filtros por estado, responsable, etiqueta y vencimiento.
- Preferencias de vista por usuario cuando no compliquen el modelo.

## 10.4 Reglas de consistencia visual

- Definir tokens de color, tipografía, espaciado, radios, sombras y estados.
- Evitar exceso de gradientes, glassmorphism y animaciones que reduzcan legibilidad.
- Usar componentes comunes para botones, diálogos, campos, badges, tablas y menús.
- Diseñar primero estados de carga, vacío, error y permisos insuficientes.
- No exponer datos sensibles en tarjetas o notificaciones fuera del contexto autorizado.

## 10.5 Orden de implementación UX

1. Design tokens y layout base.
2. Login y selección/creación de proyecto.
3. Dashboard de proyectos.
4. Tablero Kanban y edición de tareas.
5. Vista de lista y filtros.
6. Actividad, comentarios, avances y revisión.
7. Reportes y asistente IA.
8. Pulido de accesibilidad, responsive y estados de error.
