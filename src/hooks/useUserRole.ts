import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "admin" | "supervisor" | "atendente";

export function useUserRole() {
  const { user } = useAuth();

  const { data: role = null, isLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      return (data?.role as AppRole) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  return {
    role,
    isAdmin: role === "admin",
    isSupervisor: role === "supervisor",
    isAdminOrSupervisor: role === "admin" || role === "supervisor",
    isLoading,
  };
}
