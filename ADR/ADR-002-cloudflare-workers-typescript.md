# ADR-002: Cloudflare Workers + TypeScript

- Estado: Aceptado provisionalmente; requiere spike de compatibilidad.
- Fecha: 2026-10-08.

## Contexto
El usuario prefiere Cloudflare y requiere el menor costo razonable. El frontend es una SPA y el backend es una API sin estado local.

## Decisión
Desplegar frontend estático y API TypeScript en Cloudflare Workers/Static Assets, con PostgreSQL externo vía Hyperdrive.

## Alternativa evaluada
FastAPI en Python Workers está documentado y es técnicamente posible. Se prefiere TypeScript nativo para reducir fricción de runtime, compartir tipos/herramientas con frontend y aprovechar el destino elegido. Esta decisión no afirma que Python sea inferior en general.

## Consecuencias
**Positivas:** despliegue nativo, stack de lenguaje más uniforme, escala sin administrar servidores.  
**Negativas:** límites de CPU/cuotas de plan gratuito y dependencia de APIs/runtime Workers; el dominio debe permanecer portable mediante puertos y adaptadores.  
**Spike obligatorio:** comprobar consultas PostgreSQL/Hyperdrive, migraciones, autenticación, build y pruebas en Worker antes de fijar ORM/auth definitivos.
