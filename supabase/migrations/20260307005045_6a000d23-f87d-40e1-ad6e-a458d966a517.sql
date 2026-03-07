
-- Create security definer function to check org admin role
CREATE OR REPLACE FUNCTION public.is_org_admin_of(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
      AND org_id = _org_id
      AND role IN ('owner', 'admin')
  )
$$;

-- Drop the recursive policy
DROP POLICY IF EXISTS "Org admins can manage their org members" ON public.organization_members;

-- Recreate using the security definer function
CREATE POLICY "Org admins can manage their org members"
ON public.organization_members
FOR ALL
TO authenticated
USING (
  org_id = get_user_org_id(auth.uid())
  AND is_org_admin_of(org_id)
)
WITH CHECK (
  org_id = get_user_org_id(auth.uid())
  AND is_org_admin_of(org_id)
);
