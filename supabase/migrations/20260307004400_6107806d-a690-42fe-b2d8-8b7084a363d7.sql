
-- =============================================
-- MULTI-TENANT SaaS FOUNDATION
-- =============================================

-- 1. Organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. Organization members table
CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'admin', -- 'owner', 'admin', 'supervisor', 'atendente'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 3. Security definer function to get user's org_id
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- 4. Check if user belongs to same org
CREATE OR REPLACE FUNCTION public.same_org(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om1
    INNER JOIN public.organization_members om2
      ON om1.org_id = om2.org_id
    WHERE om1.user_id = auth.uid()
      AND om2.user_id = _user_id
  )
$$;

-- 5. Check if user is platform admin (has 'admin' role in user_roles)
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
$$;

-- 6. RLS for organizations
CREATE POLICY "Platform admins can manage all organizations"
  ON public.organizations FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Members can view own organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (id IN (SELECT org_id FROM public.organization_members WHERE user_id = auth.uid()));

-- 7. RLS for organization_members
CREATE POLICY "Platform admins manage all members"
  ON public.organization_members FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org admins can manage their org members"
  ON public.organization_members FOR ALL TO authenticated
  USING (
    org_id = get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE user_id = auth.uid() AND org_id = organization_members.org_id
      AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    org_id = get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE user_id = auth.uid() AND org_id = organization_members.org_id
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Members can view own org members"
  ON public.organization_members FOR SELECT TO authenticated
  USING (org_id = get_user_org_id(auth.uid()));

-- 8. Add org_id to all data tables
ALTER TABLE public.contacts ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.conversations ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.messages ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.campaigns ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.campaign_contacts ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.automations ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.automation_logs ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.templates ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.funnels ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.funnel_stages ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.scoring_rules ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.tags ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.contact_tags ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.occurrences ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.occurrence_history ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.whatsapp_instances ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.settings ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.products ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.knowledge_categories ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.knowledge_articles ADD COLUMN org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.ai_feedback ADD COLUMN org_id uuid REFERENCES public.organizations(id);

-- 9. Create indexes for org_id lookups
CREATE INDEX idx_contacts_org_id ON public.contacts(org_id);
CREATE INDEX idx_conversations_org_id ON public.conversations(org_id);
CREATE INDEX idx_messages_org_id ON public.messages(org_id);
CREATE INDEX idx_campaigns_org_id ON public.campaigns(org_id);
CREATE INDEX idx_automations_org_id ON public.automations(org_id);
CREATE INDEX idx_whatsapp_instances_org_id ON public.whatsapp_instances(org_id);
CREATE INDEX idx_templates_org_id ON public.templates(org_id);
CREATE INDEX idx_occurrences_org_id ON public.occurrences(org_id);
CREATE INDEX idx_org_members_user_id ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org_id ON public.organization_members(org_id);
