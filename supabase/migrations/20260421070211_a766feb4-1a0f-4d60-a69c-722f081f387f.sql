-- Phase 7: Advanced Behavior System

-- ============ SNAPSHOT TABLES ============

CREATE TABLE public.team_health_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  lookback_days INT NOT NULL,
  health_score NUMERIC(5,2) NOT NULL,
  activity_score NUMERIC(5,2) NOT NULL,
  deadline_score NUMERIC(5,2) NOT NULL,
  communication_score NUMERIC(5,2) NOT NULL,
  member_count INT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_health_group_time ON public.team_health_snapshots(group_id, computed_at DESC);
ALTER TABLE public.team_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_health_select_group_members ON public.team_health_snapshots
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), group_id));

CREATE TABLE public.leader_suggestions_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  lookback_days INT NOT NULL,
  consistency_score NUMERIC(5,2) NOT NULL,
  contribution_score NUMERIC(5,2) NOT NULL,
  coordination_score NUMERIC(5,2) NOT NULL,
  total_score NUMERIC(5,2) NOT NULL,
  rank INT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leader_suggestions_group_time ON public.leader_suggestions_snapshots(group_id, computed_at DESC);
ALTER TABLE public.leader_suggestions_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY leader_suggestions_select_group_members ON public.leader_suggestions_snapshots
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), group_id));

CREATE TABLE public.collaboration_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_a UUID NOT NULL,
  user_b UUID NOT NULL,
  lookback_days INT NOT NULL,
  shared_tasks INT NOT NULL,
  cross_comments INT NOT NULL,
  pair_score NUMERIC(5,2) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_a < user_b)
);
CREATE INDEX idx_collab_group_time ON public.collaboration_snapshots(group_id, computed_at DESC);
ALTER TABLE public.collaboration_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY collab_select_group_members ON public.collaboration_snapshots
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), group_id));

-- ============ FUNCTIONS ============

-- Team health: 0-100, weighted average of activity, deadlines, communication
CREATE OR REPLACE FUNCTION public.compute_team_health(_group_id UUID, _lookback_days INT DEFAULT 30)
RETURNS TABLE (
  health_score NUMERIC,
  activity_score NUMERIC,
  deadline_score NUMERIC,
  communication_score NUMERIC,
  member_count INT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _since TIMESTAMPTZ := now() - (_lookback_days || ' days')::INTERVAL;
  _members INT;
  _activity NUMERIC;
  _deadlines NUMERIC;
  _comms NUMERIC;
  _health NUMERIC;
BEGIN
  IF NOT public.is_group_member(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  SELECT COUNT(*) INTO _members FROM public.memberships WHERE group_id = _group_id;
  IF _members = 0 THEN _members := 1; END IF;

  -- activity: actions per member per day, capped/normalized to 0-100 (target: 1 action/member/day = 100)
  SELECT LEAST(100, ROUND(
    (COUNT(*)::NUMERIC / GREATEST(_members, 1) / GREATEST(_lookback_days, 1)) * 100, 2
  )) INTO _activity
  FROM public.activity_logs
  WHERE group_id = _group_id AND created_at >= _since AND actor_id IS NOT NULL;

  -- deadlines: % of completed tasks delivered on time
  SELECT COALESCE(ROUND(
    100.0 * COUNT(*) FILTER (WHERE deadline IS NULL OR updated_at <= deadline)
         / NULLIF(COUNT(*), 0), 2
  ), 100) INTO _deadlines
  FROM public.tasks
  WHERE group_id = _group_id AND status = 'completed' AND updated_at >= _since;

  -- communication: comments + messages + meeting_notes per member per day
  WITH c AS (
    SELECT COUNT(*) AS n FROM public.comments c
    JOIN public.tasks t ON t.id = c.task_id
    WHERE t.group_id = _group_id AND c.created_at >= _since
  ),
  m AS (
    SELECT COUNT(*) AS n FROM public.messages WHERE group_id = _group_id AND created_at >= _since
  ),
  mn AS (
    SELECT COUNT(*) AS n FROM public.meeting_notes WHERE group_id = _group_id AND created_at >= _since
  )
  SELECT LEAST(100, ROUND(
    ((c.n + m.n + mn.n)::NUMERIC / GREATEST(_members, 1) / GREATEST(_lookback_days, 1)) * 50, 2
  )) INTO _comms FROM c, m, mn;

  _health := ROUND((_activity * 0.35 + _deadlines * 0.40 + _comms * 0.25), 2);

  INSERT INTO public.team_health_snapshots
    (group_id, lookback_days, health_score, activity_score, deadline_score, communication_score, member_count)
  VALUES (_group_id, _lookback_days, _health, _activity, _deadlines, _comms, _members);

  RETURN QUERY SELECT _health, _activity, _deadlines, _comms, _members;
END; $$;

-- Best leader suggestions: per member scored on consistency/contribution/coordination
CREATE OR REPLACE FUNCTION public.compute_leader_suggestions(_group_id UUID, _lookback_days INT DEFAULT 30)
RETURNS TABLE (
  user_id UUID,
  consistency_score NUMERIC,
  contribution_score NUMERIC,
  coordination_score NUMERIC,
  total_score NUMERIC,
  rank INT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _since TIMESTAMPTZ := now() - (_lookback_days || ' days')::INTERVAL;
  _max_contrib NUMERIC;
BEGIN
  IF NOT public.is_group_member(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  SELECT GREATEST(MAX(score), 1) INTO _max_contrib
  FROM public.contributions WHERE group_id = _group_id;

  RETURN QUERY
  WITH members AS (
    SELECT m.user_id FROM public.memberships m WHERE m.group_id = _group_id
  ),
  consistency AS (
    -- ratio of distinct active days to lookback window, *100
    SELECT a.actor_id AS user_id,
           LEAST(100, ROUND(100.0 * COUNT(DISTINCT DATE(a.created_at)) / GREATEST(_lookback_days, 1), 2)) AS s
    FROM public.activity_logs a
    WHERE a.group_id = _group_id AND a.created_at >= _since AND a.actor_id IS NOT NULL
    GROUP BY a.actor_id
  ),
  contribution AS (
    SELECT c.user_id, ROUND(100.0 * c.score / _max_contrib, 2) AS s
    FROM public.contributions c WHERE c.group_id = _group_id
  ),
  coordination AS (
    -- comments by user on tasks in group + meeting notes created + suggestions resolved by them
    SELECT user_id, LEAST(100, ROUND(SUM(weight)::NUMERIC, 2)) AS s
    FROM (
      SELECT cm.author_id AS user_id, 2.0 AS weight
      FROM public.comments cm
      JOIN public.tasks t ON t.id = cm.task_id
      WHERE t.group_id = _group_id AND cm.created_at >= _since
      UNION ALL
      SELECT mn.created_by AS user_id, 8.0 AS weight
      FROM public.meeting_notes mn
      WHERE mn.group_id = _group_id AND mn.created_at >= _since
      UNION ALL
      SELECT ts.resolved_by AS user_id, 3.0 AS weight
      FROM public.task_suggestions ts
      WHERE ts.group_id = _group_id AND ts.resolved_at >= _since AND ts.resolved_by IS NOT NULL
    ) sub
    GROUP BY user_id
  ),
  combined AS (
    SELECT
      m.user_id,
      COALESCE(co.s, 0) AS consistency_score,
      COALESCE(ct.s, 0) AS contribution_score,
      COALESCE(cd.s, 0) AS coordination_score,
      ROUND(COALESCE(co.s,0)*0.30 + COALESCE(ct.s,0)*0.45 + COALESCE(cd.s,0)*0.25, 2) AS total_score
    FROM members m
    LEFT JOIN consistency co ON co.user_id = m.user_id
    LEFT JOIN contribution ct ON ct.user_id = m.user_id
    LEFT JOIN coordination cd ON cd.user_id = m.user_id
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY total_score DESC, user_id)::INT AS rnk FROM combined
  ),
  inserted AS (
    INSERT INTO public.leader_suggestions_snapshots
      (group_id, user_id, lookback_days, consistency_score, contribution_score, coordination_score, total_score, rank)
    SELECT _group_id, r.user_id, _lookback_days, r.consistency_score, r.contribution_score,
           r.coordination_score, r.total_score, r.rnk
    FROM ranked r
    RETURNING user_id, consistency_score, contribution_score, coordination_score, total_score, rank
  )
  SELECT i.user_id, i.consistency_score, i.contribution_score, i.coordination_score, i.total_score, i.rank
  FROM inserted i ORDER BY i.rank;
END; $$;

-- Collaboration pairs: who works well together
CREATE OR REPLACE FUNCTION public.compute_collaboration_pairs(_group_id UUID, _lookback_days INT DEFAULT 30)
RETURNS TABLE (
  user_a UUID,
  user_b UUID,
  shared_tasks INT,
  cross_comments INT,
  pair_score NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _since TIMESTAMPTZ := now() - (_lookback_days || ' days')::INTERVAL;
BEGIN
  IF NOT public.is_group_member(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  RETURN QUERY
  WITH pairs AS (
    SELECT LEAST(m1.user_id, m2.user_id) AS user_a,
           GREATEST(m1.user_id, m2.user_id) AS user_b
    FROM public.memberships m1
    JOIN public.memberships m2
      ON m1.group_id = m2.group_id AND m1.user_id < m2.user_id
    WHERE m1.group_id = _group_id
  ),
  -- shared tasks: one created, the other assigned (or vice versa)
  shared AS (
    SELECT LEAST(t.created_by, t.assigned_to) AS user_a,
           GREATEST(t.created_by, t.assigned_to) AS user_b,
           COUNT(*)::INT AS n
    FROM public.tasks t
    WHERE t.group_id = _group_id
      AND t.assigned_to IS NOT NULL
      AND t.created_by <> t.assigned_to
      AND t.created_at >= _since
    GROUP BY 1, 2
  ),
  -- cross comments: comments by user X on tasks created_by or assigned_to user Y
  cross_c AS (
    SELECT LEAST(c.author_id, party.uid) AS user_a,
           GREATEST(c.author_id, party.uid) AS user_b,
           COUNT(*)::INT AS n
    FROM public.comments c
    JOIN public.tasks t ON t.id = c.task_id
    CROSS JOIN LATERAL (
      VALUES (t.created_by), (t.assigned_to)
    ) AS party(uid)
    WHERE t.group_id = _group_id
      AND c.created_at >= _since
      AND party.uid IS NOT NULL
      AND party.uid <> c.author_id
    GROUP BY 1, 2
  ),
  combined AS (
    SELECT p.user_a, p.user_b,
           COALESCE(s.n, 0) AS shared_tasks,
           COALESCE(cc.n, 0) AS cross_comments,
           LEAST(100, ROUND(COALESCE(s.n,0) * 8.0 + COALESCE(cc.n,0) * 2.0, 2)) AS pair_score
    FROM pairs p
    LEFT JOIN shared s ON s.user_a = p.user_a AND s.user_b = p.user_b
    LEFT JOIN cross_c cc ON cc.user_a = p.user_a AND cc.user_b = p.user_b
  ),
  inserted AS (
    INSERT INTO public.collaboration_snapshots
      (group_id, user_a, user_b, lookback_days, shared_tasks, cross_comments, pair_score)
    SELECT _group_id, c.user_a, c.user_b, _lookback_days, c.shared_tasks, c.cross_comments, c.pair_score
    FROM combined c
    RETURNING user_a, user_b, shared_tasks, cross_comments, pair_score
  )
  SELECT i.user_a, i.user_b, i.shared_tasks, i.cross_comments, i.pair_score
  FROM inserted i
  ORDER BY i.pair_score DESC;
END; $$;