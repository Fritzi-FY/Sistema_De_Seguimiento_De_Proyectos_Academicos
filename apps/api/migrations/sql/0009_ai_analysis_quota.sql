-- Migration 0009: ai_analysis_quota
-- Tabla de control de cuotas y concurrencia de análisis de IA por usuario/proyecto.
-- Garantiza: máx. 1 solicitud en vuelo por (user_id, project_id) y máx. 5 análisis
-- por project_id en una ventana móvil de 10 minutos.

CREATE TABLE public.ai_analysis_quota (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text        NOT NULL,
  project_id   uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status       text        NOT NULL CHECK (status IN ('in_flight', 'completed', 'failed', 'timeout')),
  started_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);

-- Índice parcial único: impide dos solicitudes en vuelo simultáneas del mismo usuario/proyecto.
-- La unicidad solo aplica mientras status = 'in_flight', por lo que solicitudes completadas
-- no bloquean nuevas adquisiciones.
CREATE UNIQUE INDEX ai_analysis_quota_user_project_in_flight
  ON public.ai_analysis_quota (user_id, project_id)
  WHERE (status = 'in_flight');

-- Índice para la consulta de ventana deslizante de 10 minutos por proyecto.
CREATE INDEX ai_analysis_quota_project_started_at
  ON public.ai_analysis_quota (project_id, started_at DESC);

