
-- 1. Add custom_title to memberships
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS custom_title text;

-- 2. role_proposals table
CREATE TABLE IF NOT EXISTS public.role_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL,
  proposed_by uuid NOT NULL,
  proposed_role public.app_role NOT NULL,
  proposed_title text,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_proposals_group_idx ON public.role_proposals(group_id);
CREATE INDEX IF NOT EXISTS role_proposals_target_pending_idx
  ON public.role_proposals(target_user_id) WHERE status = 'pending';

ALTER TABLE public.role_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_proposals_select ON public.role_proposals;
CREATE POLICY role_proposals_select ON public.role_proposals
  FOR SELECT TO authenticated
  USING (
    target_user_id = auth.uid()
    OR proposed_by = auth.uid()
    OR public.is_group_leader(auth.uid(), group_id)
  );

DROP POLICY IF EXISTS role_proposals_insert_leader ON public.role_proposals;
CREATE POLICY role_proposals_insert_leader ON public.role_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_leader(auth.uid(), group_id)
    AND proposed_by = auth.uid()
  );

DROP POLICY IF EXISTS role_proposals_update_target_or_leader ON public.role_proposals;
CREATE POLICY role_proposals_update_target_or_leader ON public.role_proposals
  FOR UPDATE TO authenticated
  USING (
    target_user_id = auth.uid()
    OR public.is_group_leader(auth.uid(), group_id)
  )
  WITH CHECK (
    target_user_id = auth.uid()
    OR public.is_group_leader(auth.uid(), group_id)
  );

DROP TRIGGER IF EXISTS role_proposals_touch ON public.role_proposals;
CREATE TRIGGER role_proposals_touch
  BEFORE UPDATE ON public.role_proposals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. RPC: propose role change (leader only)
CREATE OR REPLACE FUNCTION public.propose_role_change(
  _group_id uuid,
  _target_user_id uuid,
  _proposed_role public.app_role,
  _proposed_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _proposal_id uuid;
  _target_membership uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_group_leader(_uid, _group_id) THEN
    RAISE EXCEPTION 'Only the group leader can propose role changes';
  END IF;

  SELECT m.id INTO _target_membership
  FROM public.memberships m
  WHERE m.group_id = _group_id AND m.user_id = _target_user_id;

  IF _target_membership IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this group';
  END IF;

  -- Leader changing their own title (not role) applies immediately.
  IF _target_user_id = _uid THEN
    UPDATE public.memberships
       SET custom_title = NULLIF(trim(_proposed_title), '')
     WHERE id = _target_membership;
    RETURN NULL;
  END IF;

  -- Cannot propose to make someone else a leader via this RPC.
  IF _proposed_role = 'leader' THEN
    RAISE EXCEPTION 'Use transfer leadership flow to assign the leader role';
  END IF;

  -- Cancel any existing pending proposal for this user in this group
  UPDATE public.role_proposals
     SET status = 'cancelled', resolved_at = now()
   WHERE group_id = _group_id
     AND target_user_id = _target_user_id
     AND status = 'pending';

  INSERT INTO public.role_proposals
    (group_id, target_user_id, proposed_by, proposed_role, proposed_title)
  VALUES
    (_group_id, _target_user_id, _uid, _proposed_role, NULLIF(trim(_proposed_title), ''))
  RETURNING id INTO _proposal_id;

  RETURN _proposal_id;
END;
$$;

-- 4. RPC: respond to a proposal (target only)
CREATE OR REPLACE FUNCTION public.respond_role_proposal(
  _proposal_id uuid,
  _accept boolean,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _p public.role_proposals%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _p FROM public.role_proposals WHERE id = _proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found';
  END IF;

  IF _p.target_user_id <> _uid THEN
    RAISE EXCEPTION 'Only the target user can respond to this proposal';
  END IF;

  IF _p.status <> 'pending' THEN
    RAISE EXCEPTION 'This proposal has already been resolved';
  END IF;

  IF _accept THEN
    UPDATE public.memberships
       SET role = _p.proposed_role,
           custom_title = _p.proposed_title
     WHERE group_id = _p.group_id AND user_id = _uid;

    UPDATE public.role_proposals
       SET status = 'accepted', resolved_at = now(), decline_reason = NULL
     WHERE id = _proposal_id;
  ELSE
    IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
      RAISE EXCEPTION 'A justification is required when declining (min 3 characters)';
    END IF;

    UPDATE public.role_proposals
       SET status = 'declined',
           decline_reason = trim(_reason),
           resolved_at = now()
     WHERE id = _proposal_id;
  END IF;
END;
$$;
