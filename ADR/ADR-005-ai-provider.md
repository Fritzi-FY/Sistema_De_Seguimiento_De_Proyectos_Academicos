# ADR-005: IA mediante puerto AIProvider y adaptador OpenRouter

- Estado: Aceptado.
- Fecha: 2026-10-08.

## Decisión
Casos de uso dependen de `AIProvider`, no de OpenRouter directamente. El adaptador OpenRouter es el primero; los tests usan fake/mock. La IA resume avances, señala riesgos potenciales y propone próximos pasos.

## Restricciones
No calificar automáticamente, no enviar secretos ni datos fuera del proyecto autorizado, limitar gasto/tokens, mostrar resultados como sugerencias y degradar sin bloquear funciones centrales.
