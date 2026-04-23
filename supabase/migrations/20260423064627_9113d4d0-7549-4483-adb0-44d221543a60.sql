-- Allow non-members to redeem an invite code and immediately join the group.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(_code text)
RETURNS TABLE(group_id uuid, group_name text, already_member boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _invite RECORD;
  _existing uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT i.id, i.group_id, i.revoked_at, i.expires_at
    INTO _invite
  FROM public.group_invites i
  WHERE i.code = upper(trim(_code))
  LIMIT 1;

  IF _invite IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  IF _invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invite has been revoked';
  END IF;

  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  -- Already a member?
  SELECT m.id INTO _existing
  FROM public.memberships m
  WHERE m.group_id = _invite.group_id AND m.user_id = _uid
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN QUERY
      SELECT g.id, g.name, true
      FROM public.groups g WHERE g.id = _invite.group_id;
    RETURN;
  END IF;

  -- Add as member of the dedicated group
  INSERT INTO public.memberships (group_id, user_id, role)
  VALUES (_invite.group_id, _uid, 'member');

  -- Mark any pending join request resolved
  UPDATE public.group_join_requests
     SET status = 'approved', resolved_at = now(), resolved_by = _uid
   WHERE group_id = _invite.group_id
     AND user_id = _uid
     AND status = 'pending';

  RETURN QUERY
    SELECT g.id, g.name, false
    FROM public.groups g WHERE g.id = _invite.group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;