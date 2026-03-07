
-- Fix organization_members RLS: all policies are RESTRICTIVE causing issues
-- Drop all existing policies
DROP POLICY IF EXISTS "Members can view own org members" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins can manage their org members" ON public.organization_members;
DROP POLICY IF EXISTS "Platform admins manage all members" ON public.organization_members;

-- Recreate as PERMISSIVE policies (any one can grant access)
CREATE POLICY "Platform admins manage all members"
ON public.organization_members
FOR ALL
TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY "Members can view own org members"
ON public.organization_members
FOR SELECT
TO authenticated
USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org admins can manage their org members"
ON public.organization_members
FOR ALL
TO authenticated
USING (is_org_admin_of(org_id))
WITH CHECK (is_org_admin_of(org_id));

-- Also fix organizations SELECT policy
DROP POLICY IF EXISTS "Members can view own organization" ON public.organizations;

CREATE POLICY "Members can view own organization"
ON public.organizations
FOR SELECT
TO authenticated
USING (id = get_user_org_id(auth.uid()));
