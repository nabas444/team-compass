-- ============ SUBTASKS ============
CREATE TABLE public.subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_subtasks_updated BEFORE UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ COMMENTS ============
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_comments_updated BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ ACTIVITY LOG ============
CREATE TYPE public.activity_action AS ENUM (
  'task_created',
  'task_status_changed',
  'task_assigned',
  'task_deleted',
  'comment_added',
  'subtask_created',
  'subtask_completed'
);

CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action public.activity_action NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- ============ INDEXES ============
CREATE INDEX idx_subtasks_task ON public.subtasks(task_id);
CREATE INDEX idx_comments_task ON public.comments(task_id);
CREATE INDEX idx_activity_group ON public.activity_logs(group_id, created_at DESC);
CREATE INDEX idx_activity_task ON public.activity_logs(task_id);
CREATE INDEX idx_activity_actor ON public.activity_logs(actor_id);

-- ============ Helper: get group_id for a task ============
CREATE OR REPLACE FUNCTION public.task_group_id(_task_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_id FROM public.tasks WHERE id = _task_id
$$;

-- ============ RLS: SUBTASKS ============
CREATE POLICY "subtasks_select_group_members" ON public.subtasks
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), public.task_group_id(task_id)));

CREATE POLICY "subtasks_insert_group_members" ON public.subtasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_member(auth.uid(), public.task_group_id(task_id))
    AND created_by = auth.uid()
  );

CREATE POLICY "subtasks_update_task_owner_or_assignee" ON public.subtasks
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ));

CREATE POLICY "subtasks_delete_task_owner_or_assignee" ON public.subtasks
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ));

-- ============ RLS: COMMENTS ============
CREATE POLICY "comments_select_group_members" ON public.comments
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), public.task_group_id(task_id)));

CREATE POLICY "comments_insert_group_members" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_member(auth.uid(), public.task_group_id(task_id))
    AND author_id = auth.uid()
  );

CREATE POLICY "comments_update_author" ON public.comments
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "comments_delete_author" ON public.comments
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- ============ RLS: ACTIVITY LOGS (read-only from app) ============
CREATE POLICY "activity_logs_select_group_members" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), group_id));
-- No INSERT/UPDATE/DELETE policies → only SECURITY DEFINER triggers can write

-- ============ ACTIVITY TRIGGERS ============

-- Tasks: log create + status change
CREATE OR REPLACE FUNCTION public.log_task_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
    VALUES (NEW.group_id, NEW.id, NEW.created_by, 'task_created',
            jsonb_build_object('title', NEW.title, 'assigned_to', NEW.assigned_to));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
      VALUES (NEW.group_id, NEW.id, auth.uid(), 'task_status_changed',
              jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
      VALUES (NEW.group_id, NEW.id, auth.uid(), 'task_assigned',
              jsonb_build_object('from', OLD.assigned_to, 'to', NEW.assigned_to));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tasks_activity
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

-- Comments: log on insert
CREATE OR REPLACE FUNCTION public.log_comment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _group_id UUID;
BEGIN
  SELECT group_id INTO _group_id FROM public.tasks WHERE id = NEW.task_id;
  INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
  VALUES (_group_id, NEW.task_id, NEW.author_id, 'comment_added',
          jsonb_build_object('comment_id', NEW.id));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comments_activity
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.log_comment_activity();

-- Subtasks: log on insert + completion toggle
CREATE OR REPLACE FUNCTION public.log_subtask_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _group_id UUID;
BEGIN
  SELECT group_id INTO _group_id FROM public.tasks WHERE id = NEW.task_id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
    VALUES (_group_id, NEW.task_id, NEW.created_by, 'subtask_created',
            jsonb_build_object('subtask_id', NEW.id, 'title', NEW.title));
  ELSIF TG_OP = 'UPDATE' AND NEW.completed IS DISTINCT FROM OLD.completed AND NEW.completed = true THEN
    INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
    VALUES (_group_id, NEW.task_id, auth.uid(), 'subtask_completed',
            jsonb_build_object('subtask_id', NEW.id, 'title', NEW.title));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subtasks_activity
  AFTER INSERT OR UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.log_subtask_activity();