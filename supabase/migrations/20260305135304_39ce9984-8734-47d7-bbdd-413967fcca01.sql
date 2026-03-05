
-- Table: attendant-supervisor hierarchy
CREATE TABLE public.attendant_supervisors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendant_user_id uuid NOT NULL,
  supervisor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attendant_user_id)
);

ALTER TABLE public.attendant_supervisors ENABLE ROW LEVEL SECURITY;

-- Supervisors can manage their own attendants
CREATE POLICY "Supervisors manage own attendants"
  ON public.attendant_supervisors FOR ALL
  TO authenticated
  USING (supervisor_user_id = auth.uid())
  WITH CHECK (supervisor_user_id = auth.uid());

-- Admins can manage all
CREATE POLICY "Admins manage all attendant_supervisors"
  ON public.attendant_supervisors FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Attendants can view their own record
CREATE POLICY "Attendants view own supervisor link"
  ON public.attendant_supervisors FOR SELECT
  TO authenticated
  USING (attendant_user_id = auth.uid());

-- Table: attendant-instance visibility
CREATE TABLE public.attendant_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendant_user_id uuid NOT NULL,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attendant_user_id, instance_id)
);

ALTER TABLE public.attendant_instances ENABLE ROW LEVEL SECURITY;

-- Supervisors can manage instance assignments for their attendants
CREATE POLICY "Supervisors manage attendant instances"
  ON public.attendant_instances FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendant_supervisors
      WHERE attendant_supervisors.attendant_user_id = attendant_instances.attendant_user_id
        AND attendant_supervisors.supervisor_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendant_supervisors
      WHERE attendant_supervisors.attendant_user_id = attendant_instances.attendant_user_id
        AND attendant_supervisors.supervisor_user_id = auth.uid()
    )
  );

-- Admins can manage all
CREATE POLICY "Admins manage all attendant_instances"
  ON public.attendant_instances FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Attendants can view their own assignments
CREATE POLICY "Attendants view own instances"
  ON public.attendant_instances FOR SELECT
  TO authenticated
  USING (attendant_user_id = auth.uid());
