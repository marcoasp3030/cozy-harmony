
-- Per-user permissions table
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  allowed_pages text[] NOT NULL DEFAULT ARRAY['dashboard', 'inbox', 'contacts', 'campaigns', 'automations', 'funnels', 'occurrences', 'queue', 'templates', 'reports', 'settings']::text[],
  can_create_campaigns boolean NOT NULL DEFAULT true,
  can_execute_campaigns boolean NOT NULL DEFAULT true,
  can_delete_campaigns boolean NOT NULL DEFAULT false,
  can_create_contacts boolean NOT NULL DEFAULT true,
  can_edit_contacts boolean NOT NULL DEFAULT true,
  can_delete_contacts boolean NOT NULL DEFAULT false,
  can_create_automations boolean NOT NULL DEFAULT true,
  can_edit_automations boolean NOT NULL DEFAULT true,
  can_delete_automations boolean NOT NULL DEFAULT false,
  can_manage_templates boolean NOT NULL DEFAULT true,
  can_view_reports boolean NOT NULL DEFAULT true,
  can_manage_funnels boolean NOT NULL DEFAULT true,
  can_manage_occurrences boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all permissions
CREATE POLICY "Admins can manage all permissions"
  ON public.user_permissions FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Users can view own permissions
CREATE POLICY "Users can view own permissions"
  ON public.user_permissions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Supervisors can view all permissions (to see their team)
CREATE POLICY "Supervisors can view all permissions"
  ON public.user_permissions FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role));
