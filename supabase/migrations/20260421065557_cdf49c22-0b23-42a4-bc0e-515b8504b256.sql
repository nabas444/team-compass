-- Phase 6 part 2: Tables + RLS + triggers

-- ============ MESSAGES ============
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  body TEXT NOT NULL,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_group_created ON public.messages(group_id, created_at DESC);
CREATE INDEX idx_messages_task_created ON public.messages(task_id, created_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX idx_messages_author ON public.messages(author_id);

CREATE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select_group_members ON public.messages
FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY messages_insert_group_members ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  public.is_group_member(auth.uid(), group_id)
  AND author_id = auth.uid()
  AND (task_id IS NULL OR public.task_group_id(task_id) = group_id)
);

CREATE POLICY messages_update_author ON public.messages
FOR UPDATE TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());

CREATE POLICY messages_delete_author ON public.messages
FOR DELETE TO authenticated
USING (author_id = auth.uid());

-- ============ TASK SUGGESTIONS ============
CREATE TYPE public.suggestion_status AS ENUM ('pending', 'accepted', 'dismissed');

CREATE TABLE public.task_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  suggested_title TEXT NOT NULL,
  suggested_assignee UUID,
  suggested_deadline TIMESTAMPTZ,
  status public.suggestion_status NOT NULL DEFAULT 'pending',
  created_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_suggestions_group_status ON public.task_suggestions(group_id, status);
CREATE INDEX idx_task_suggestions_message ON public.task_suggestions(message_id);

CREATE TRIGGER trg_task_suggestions_updated_at
BEFORE UPDATE ON public.task_suggestions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.task_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_suggestions_select_group_members ON public.task_suggestions
FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

-- INSERT will typically be done by an AI edge function (service role).
-- We still allow group members to insert (e.g. manual suggestions) for flexibility.
CREATE POLICY task_suggestions_insert_group_members ON public.task_suggestions
FOR INSERT TO authenticated
WITH CHECK (public.is_group_member(auth.uid(), group_id));

CREATE POLICY task_suggestions_update_group_members ON public.task_suggestions
FOR UPDATE TO authenticated
USING (public.is_group_member(auth.uid(), group_id))
WITH CHECK (public.is_group_member(auth.uid(), group_id));

-- ============ MEETING NOTES ============
CREATE TABLE public.meeting_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_from TIMESTAMPTZ,
  source_to TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meeting_notes_group_created ON public.meeting_notes(group_id, created_at DESC);
CREATE INDEX idx_meeting_notes_task ON public.meeting_notes(task_id) WHERE task_id IS NOT NULL;

CREATE TRIGGER trg_meeting_notes_updated_at
BEFORE UPDATE ON public.meeting_notes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_notes_select_group_members ON public.meeting_notes
FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY meeting_notes_insert_group_members ON public.meeting_notes
FOR INSERT TO authenticated
WITH CHECK (
  public.is_group_member(auth.uid(), group_id)
  AND created_by = auth.uid()
  AND (task_id IS NULL OR public.task_group_id(task_id) = group_id)
);

CREATE POLICY meeting_notes_update_creator ON public.meeting_notes
FOR UPDATE TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

CREATE POLICY meeting_notes_delete_creator ON public.meeting_notes
FOR DELETE TO authenticated
USING (created_by = auth.uid());

-- ============ ACTIVITY LOGGING TRIGGERS ============

CREATE OR REPLACE FUNCTION public.log_message_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
  VALUES (NEW.group_id, NEW.task_id, NEW.author_id, 'message_sent',
          jsonb_build_object('message_id', NEW.id, 'has_task', NEW.task_id IS NOT NULL));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_message_activity
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.log_message_activity();

CREATE OR REPLACE FUNCTION public.log_task_suggestion_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
  VALUES (NEW.group_id, NULL, auth.uid(), 'task_suggested',
          jsonb_build_object('suggestion_id', NEW.id, 'message_id', NEW.message_id, 'title', NEW.suggested_title));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_task_suggestion_activity
AFTER INSERT ON public.task_suggestions
FOR EACH ROW EXECUTE FUNCTION public.log_task_suggestion_activity();

CREATE OR REPLACE FUNCTION public.log_meeting_notes_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_logs (group_id, task_id, actor_id, action, details)
  VALUES (NEW.group_id, NEW.task_id, NEW.created_by, 'meeting_notes_created',
          jsonb_build_object('notes_id', NEW.id, 'title', NEW.title));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_meeting_notes_activity
AFTER INSERT ON public.meeting_notes
FOR EACH ROW EXECUTE FUNCTION public.log_meeting_notes_activity();