
CREATE TABLE public.automation_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_phone TEXT,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,
  nodes_executed JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_automation_logs_automation_id ON public.automation_logs(automation_id);
CREATE INDEX idx_automation_logs_created_at ON public.automation_logs(created_at DESC);

-- RLS
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view automation_logs"
  ON public.automation_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable realtime for live log updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_logs;
