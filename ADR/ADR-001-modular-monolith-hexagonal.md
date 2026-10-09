# ADR-001: Monolito modular y arquitectura hexagonal

- Estado: Aceptado como línea base.
- Fecha: 2026-10-08.

## Contexto
El proyecto debe demostrar decisiones arquitectónicas, seguridad, pruebas, CI/CD y escalabilidad durante un semestre con presupuesto reducido.

## Decisión
Usar un monolito modular con arquitectura hexagonal/Clean Architecture, API REST y PostgreSQL. No separar microservicios en la primera versión.

## Consecuencias
**Positivas:** menos complejidad operativa, despliegue sencillo, límites de dominio claros y pruebas con adaptadores simulados.  
**Negativas:** módulos comparten despliegue y base de datos; se requiere disciplina para evitar acoplamiento interno.  
**Revisión:** considerar extracción de servicio solo con evidencia de carga, autonomía de despliegue o necesidades operativas.
