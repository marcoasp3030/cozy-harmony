
-- Create whatsapp_instances table
CREATE TABLE public.whatsapp_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  admin_token TEXT DEFAULT '',
  instance_token TEXT DEFAULT '',
  instance_name TEXT DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'disconnected',
  phone TEXT,
  device_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own instances"
  ON public.whatsapp_instances
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER update_whatsapp_instances_updated_at
  BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add instance_id to campaigns table (nullable for backward compatibility)
ALTER TABLE public.campaigns ADD COLUMN instance_id UUID REFERENCES public.whatsapp_instances(id);

-- Enable realtime for instances
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_instances;
