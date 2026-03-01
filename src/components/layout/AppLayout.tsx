import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { sendPushNotification } from "@/hooks/usePushNotifications";
import { toast } from "sonner";

const CRITICAL_TYPES = ["furto", "loja_sem_energia", "acesso_bloqueado", "produto_vencido"];

const TYPE_LABELS: Record<string, string> = {
  furto: "Furto",
  loja_sem_energia: "Sem Energia",
  acesso_bloqueado: "Acesso Bloqueado",
  produto_vencido: "Produto Vencido",
};

const AppLayout = () => {
  // Global listener for critical occurrences
  useEffect(() => {
    const channel = supabase
      .channel("critical-occurrences")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "occurrences" },
        (payload) => {
          const occ = payload.new as any;
          if (CRITICAL_TYPES.includes(occ.type) || occ.priority === "urgente" || occ.priority === "alta") {
            const typeLabel = TYPE_LABELS[occ.type] || occ.type;
            toast.error(`🚨 Ocorrência Crítica — ${occ.store_name}`, {
              description: `${typeLabel}: ${(occ.description || "").slice(0, 80)}`,
              duration: 10000,
            });
            sendPushNotification({
              title: `🚨 Ocorrência Crítica — ${occ.store_name}`,
              body: `${typeLabel}: ${(occ.description || "").slice(0, 100)}`,
              tag: `occ-critical-${occ.id}`,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
