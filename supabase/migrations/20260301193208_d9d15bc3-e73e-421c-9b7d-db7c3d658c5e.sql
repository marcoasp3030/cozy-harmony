
CREATE TABLE public.occurrence_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurrence_id UUID NOT NULL REFERENCES public.occurrences(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.occurrence_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage occurrence_history"
  ON public.occurrence_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_occurrence_history_occurrence_id ON public.occurrence_history(occurrence_id);
