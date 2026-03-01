
CREATE TABLE public.occurrences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reclamacao',
  description TEXT NOT NULL,
  contact_phone TEXT,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',
  priority TEXT NOT NULL DEFAULT 'normal',
  resolution TEXT,
  created_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage occurrences"
  ON public.occurrences
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_occurrences_updated_at
  BEFORE UPDATE ON public.occurrences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
