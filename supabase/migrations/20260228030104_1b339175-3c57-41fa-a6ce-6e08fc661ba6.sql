
-- Funnels table
CREATE TABLE public.funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.funnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage funnels"
  ON public.funnels FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Funnel stages table
CREATE TABLE public.funnel_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  position integer NOT NULL DEFAULT 0,
  auto_move_on_reply boolean NOT NULL DEFAULT false,
  notify_after_hours numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.funnel_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage funnel_stages"
  ON public.funnel_stages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Add funnel references to conversations
ALTER TABLE public.conversations
  ADD COLUMN funnel_id uuid REFERENCES public.funnels(id) ON DELETE SET NULL,
  ADD COLUMN funnel_stage_id uuid REFERENCES public.funnel_stages(id) ON DELETE SET NULL;

-- Insert default funnel
INSERT INTO public.funnels (name, description, is_default) 
VALUES ('Atendimento Padrão', 'Funil padrão de atendimento ao cliente', true);

-- Insert default stages for the default funnel
INSERT INTO public.funnel_stages (funnel_id, name, color, position)
SELECT f.id, s.name, s.color, s.position
FROM public.funnels f,
(VALUES 
  ('Abertas', '#22c55e', 0),
  ('Em Atendimento', '#3b82f6', 1),
  ('Aguardando', '#f59e0b', 2),
  ('Resolvidas', '#6b7280', 3)
) AS s(name, color, position)
WHERE f.is_default = true;

-- Trigger for updated_at
CREATE TRIGGER update_funnels_updated_at
  BEFORE UPDATE ON public.funnels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime for funnels
ALTER PUBLICATION supabase_realtime ADD TABLE public.funnels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.funnel_stages;
