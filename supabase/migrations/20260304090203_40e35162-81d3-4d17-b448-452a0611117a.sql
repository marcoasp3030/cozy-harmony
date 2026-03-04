
-- Table for AI suggestion feedback (thumbs up/down)
CREATE TABLE public.ai_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  suggestion_text TEXT NOT NULL,
  suggestion_label TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ai_feedback"
  ON public.ai_feedback FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Add conversation_summary column to contacts for long-term memory
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS conversation_summary TEXT;

-- Enable realtime for ai_feedback
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_feedback;
