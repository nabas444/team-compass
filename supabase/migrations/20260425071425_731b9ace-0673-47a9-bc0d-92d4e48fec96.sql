-- Add 'co_leader' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'co_leader';