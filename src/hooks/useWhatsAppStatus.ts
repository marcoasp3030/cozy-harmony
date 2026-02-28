import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type ConnectionStatus = "idle" | "checking" | "connected" | "disconnected" | "error";

interface InstanceStatus {
  id: string;
  name: string;
  status: ConnectionStatus;
  phone?: string;
  deviceName?: string;
}

export function useWhatsAppStatus(intervalMs = 60_000) {
  const { user } = useAuth();
  const [instances, setInstances] = useState<InstanceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Legacy single-instance compat
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [info, setInfo] = useState<{ phone?: string; name?: string } | null>(null);

  const check = useCallback(async () => {
    if (!user) return;

    // Load instances from table
    const { data: dbInstances } = await supabase
      .from("whatsapp_instances")
      .select("id, name, status, phone, device_name, is_default")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false });

    if (dbInstances && dbInstances.length > 0) {
      const mapped: InstanceStatus[] = (dbInstances as any[]).map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status === "connected" ? "connected" : "disconnected",
        phone: i.phone || undefined,
        deviceName: i.device_name || undefined,
      }));
      setInstances(mapped);
      
      // Legacy compat: use default instance
      const def = mapped[0];
      setStatus(def.status);
      setInfo(def.status === "connected" ? { phone: def.phone, name: def.deviceName } : null);
    } else {
      // Legacy fallback
      const { data: settings } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "uazapi_config")
        .single();

      const config = settings?.value as { baseUrl?: string; instanceToken?: string } | null;
      if (!config?.baseUrl || !config?.instanceToken) {
        setStatus("idle");
        return;
      }

      setStatus("checking");
      try {
        const { data, error } = await supabase.functions.invoke("uazapi-instance", {
          body: { action: "test" },
        });
        if (error) throw error;
        if (data.connected) {
          setStatus("connected");
          setInfo({
            phone: data.phone || data.instance?.user?.id?.replace("@s.whatsapp.net", "") || undefined,
            name: data.name || data.instance?.user?.name || data.pushname || undefined,
          });
        } else {
          setStatus("disconnected");
          setInfo(null);
        }
      } catch {
        setStatus("error");
        setInfo(null);
      }
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [check, intervalMs]);

  return { status, info, instances, loading, refresh: check };
}
