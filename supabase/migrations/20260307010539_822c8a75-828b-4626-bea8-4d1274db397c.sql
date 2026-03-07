
-- Fix organization_members RLS: drop RESTRICTIVE policies and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Members can view own org members" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins can manage their org members" ON public.organization_members;
DROP POLICY IF EXISTS "Platform admins manage all members" ON public.organization_members;

-- Platform admins: full access (PERMISSIVE - any matching policy grants access)
CREATE POLICY "Platform admins manage all members"
ON public.organization_members
FOR ALL
TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

-- Members can view their own org members
CREATE POLICY "Members can view own org members"
ON public.organization_members
FOR SELECT
TO authenticated
USING (org_id = get_user_org_id(auth.uid()));

-- Org admins can manage members in their org
CREATE POLICY "Org admins can manage their org members"
ON public.organization_members
FOR ALL
TO authenticated
USING (is_org_admin_of(org_id))
WITH CHECK (is_org_admin_of(org_id));
