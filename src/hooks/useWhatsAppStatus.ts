import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type ConnectionStatus = "idle" | "checking" | "connected" | "disconnected" | "error";

interface ConnectionInfo {
  phone?: string;
  name?: string;
}

export function useWhatsAppStatus(intervalMs = 60_000) {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [info, setInfo] = useState<ConnectionInfo | null>(null);

  const check = useCallback(async () => {
    if (!user) return;

    // Check if config exists first
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
  }, [user]);

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [check, intervalMs]);

  return { status, info, refresh: check };
}
