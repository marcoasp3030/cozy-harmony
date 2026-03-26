
-- Create message retry queue table
CREATE TABLE public.message_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  
  -- Message payload (stored for replay)
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Retry tracking
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  last_attempted_at timestamptz,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  
  -- Status: pending, retrying, delivered, failed (permanently)
  status text NOT NULL DEFAULT 'pending',
  
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  
  -- Original send context
  phone text NOT NULL,
  message_type text NOT NULL DEFAULT 'text'
);

-- Index for efficient queue processing
CREATE INDEX idx_retry_queue_next ON public.message_retry_queue (next_retry_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX idx_retry_queue_org ON public.message_retry_queue (org_id);
CREATE INDEX idx_retry_queue_status ON public.message_retry_queue (status);

-- Enable RLS
ALTER TABLE public.message_retry_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Org members manage org retry queue"
  ON public.message_retry_queue FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Platform admins can manage all retry queue"
  ON public.message_retry_queue FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Auto-set org_id trigger
CREATE TRIGGER set_org_id_retry_queue
  BEFORE INSERT ON public.message_retry_queue
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();
