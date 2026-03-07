import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

export interface OrgMembership {
  org_id: string;
  role: string;
  organization: Organization;
}

export function useOrganization() {
  const { user } = useAuth();

  const { data: membership = null, isLoading } = useQuery({
    queryKey: ["user-org", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("organization_members")
        .select("org_id, role, organizations(id, name, slug, is_active, created_at)")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) return null;
      return {
        org_id: data.org_id,
        role: data.role,
        organization: data.organizations as unknown as Organization,
      } as OrgMembership;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return {
    orgId: membership?.org_id ?? null,
    orgRole: membership?.role ?? null,
    organization: membership?.organization ?? null,
    isOrgOwner: membership?.role === "owner",
    isOrgAdmin: membership?.role === "owner" || membership?.role === "admin",
    hasOrg: !!membership,
    isLoading,
  };
}
