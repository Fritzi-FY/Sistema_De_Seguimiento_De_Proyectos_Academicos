CREATE TABLE public.teacher_project_assignments (
 teacher_user_id text NOT NULL CHECK (length(btrim(teacher_user_id)) > 0),
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
 PRIMARY KEY (teacher_user_id, project_id)
);
