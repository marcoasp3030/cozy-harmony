import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

export const ALL_PAGES = [
  "dashboard",
  "inbox",
  "contacts",
  "campaigns",
  "automations",
  "funnels",
  "occurrences",
  "queue",
  "templates",
  "reports",
  "settings",
] as const;

export type PageKey = (typeof ALL_PAGES)[number];

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  inbox: "Inbox",
  contacts: "Contatos",
  campaigns: "Campanhas",
  automations: "Automações",
  funnels: "Funis",
  occurrences: "Ocorrências",
  queue: "Fila",
  templates: "Templates",
  reports: "Relatórios",
  settings: "Configurações",
};

export interface FeaturePermissions {
  can_create_campaigns: boolean;
  can_execute_campaigns: boolean;
  can_delete_campaigns: boolean;
  can_create_contacts: boolean;
  can_edit_contacts: boolean;
  can_delete_contacts: boolean;
  can_create_automations: boolean;
  can_edit_automations: boolean;
  can_delete_automations: boolean;
  can_manage_templates: boolean;
  can_view_reports: boolean;
  can_manage_funnels: boolean;
  can_manage_occurrences: boolean;
}

export interface UserPermissions extends FeaturePermissions {
  allowed_pages: string[];
}

const DEFAULT_PERMISSIONS: UserPermissions = {
  allowed_pages: [...ALL_PAGES],
  can_create_campaigns: true,
  can_execute_campaigns: true,
  can_delete_campaigns: false,
  can_create_contacts: true,
  can_edit_contacts: true,
  can_delete_contacts: false,
  can_create_automations: true,
  can_edit_automations: true,
  can_delete_automations: false,
  can_manage_templates: true,
  can_view_reports: true,
  can_manage_funnels: true,
  can_manage_occurrences: true,
};

export function useUserPermissions() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isLoading: isRoleLoading } = useUserRole();

  const { data: permissions = null, isLoading: isPermLoading } = useQuery({
    queryKey: ["user-permissions", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("user_permissions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) return DEFAULT_PERMISSIONS;
      return {
        allowed_pages: data.allowed_pages as string[],
        can_create_campaigns: data.can_create_campaigns,
        can_execute_campaigns: data.can_execute_campaigns,
        can_delete_campaigns: data.can_delete_campaigns,
        can_create_contacts: data.can_create_contacts,
        can_edit_contacts: data.can_edit_contacts,
        can_delete_contacts: data.can_delete_contacts,
        can_create_automations: data.can_create_automations,
        can_edit_automations: data.can_edit_automations,
        can_delete_automations: data.can_delete_automations,
        can_manage_templates: data.can_manage_templates,
        can_view_reports: data.can_view_reports,
        can_manage_funnels: data.can_manage_funnels,
        can_manage_occurrences: data.can_manage_occurrences,
      } as UserPermissions;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = isRoleLoading || isPermLoading;

  // Admins always have full access
  const effectivePermissions = isAdmin ? DEFAULT_PERMISSIONS : permissions;

  const canAccessPage = (page: string) => {
    if (isAdmin) return true;
    return effectivePermissions?.allowed_pages?.includes(page) ?? false;
  };

  const canDo = (feature: keyof FeaturePermissions) => {
    if (isAdmin) return true;
    return effectivePermissions?.[feature] ?? false;
  };

  return {
    permissions: effectivePermissions,
    isLoading,
    canAccessPage,
    canDo,
  };
}
