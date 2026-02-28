import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface WhatsAppInstance {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  admin_token: string;
  instance_token: string;
  instance_name: string;
  is_default: boolean;
  status: string;
  phone: string | null;
  device_name: string | null;
  created_at: string;
  updated_at: string;
}

export function useWhatsAppInstances() {
  const { user } = useAuth();
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    setInstances((data as unknown as WhatsAppInstance[]) || []);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const addInstance = async (instance: Partial<WhatsAppInstance>) => {
    if (!user) return null;
    // If first instance, make it default
    const isFirst = instances.length === 0;
    const { data, error } = await supabase
      .from("whatsapp_instances")
      .insert({
        user_id: user.id,
        name: instance.name || "WhatsApp",
        base_url: instance.base_url || "",
        admin_token: instance.admin_token || "",
        instance_token: instance.instance_token || "",
        instance_name: instance.instance_name || "",
        is_default: isFirst || instance.is_default || false,
      } as any)
      .select()
      .single();
    if (!error) await load();
    return { data: data as unknown as WhatsAppInstance | null, error };
  };

  const updateInstance = async (id: string, updates: Partial<WhatsAppInstance>) => {
    const { error } = await supabase
      .from("whatsapp_instances")
      .update(updates as any)
      .eq("id", id);
    if (!error) await load();
    return { error };
  };

  const deleteInstance = async (id: string) => {
    const { error } = await supabase
      .from("whatsapp_instances")
      .delete()
      .eq("id", id);
    if (!error) await load();
    return { error };
  };

  const setDefault = async (id: string) => {
    if (!user) return;
    // Remove default from all
    await supabase
      .from("whatsapp_instances")
      .update({ is_default: false } as any)
      .eq("user_id", user.id);
    // Set new default
    await supabase
      .from("whatsapp_instances")
      .update({ is_default: true } as any)
      .eq("id", id);
    await load();
  };

  const defaultInstance = instances.find((i) => i.is_default) || instances[0] || null;

  return { instances, loading, load, addInstance, updateInstance, deleteInstance, setDefault, defaultInstance };
}
