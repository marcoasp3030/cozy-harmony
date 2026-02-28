ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS sla_hours numeric NULL;