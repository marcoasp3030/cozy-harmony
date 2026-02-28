
-- Add score to conversations for lead scoring
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0;

-- Add stage actions config and auto-move target to funnel_stages
ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS auto_move_stage_id uuid REFERENCES public.funnel_stages(id) ON DELETE SET NULL;
ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS score_threshold integer DEFAULT NULL;

-- Create scoring_rules table for configurable scoring
CREATE TABLE IF NOT EXISTS public.scoring_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  funnel_id uuid REFERENCES public.funnels(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL DEFAULT 'message_received',
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  points integer NOT NULL DEFAULT 1,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scoring_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage scoring_rules" ON public.scoring_rules FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for conversations score updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.scoring_rules;
