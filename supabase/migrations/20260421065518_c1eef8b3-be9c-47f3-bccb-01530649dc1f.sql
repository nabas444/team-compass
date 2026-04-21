-- Phase 6: Communication Intelligence (schema only)

-- 1. Extend activity_action enum
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'message_sent';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'task_suggested';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'meeting_notes_created';