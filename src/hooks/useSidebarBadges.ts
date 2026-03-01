import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SidebarBadges {
  inbox: number;
  contacts: number;
  campaigns: number;
  automations: number;
}

export function useSidebarBadges() {
  const [badges, setBadges] = useState<SidebarBadges>({
    inbox: 0,
    contacts: 0,
    campaigns: 0,
    automations: 0,
  });

  useEffect(() => {
    const fetchBadges = async () => {
      // Unread conversations
      const { count: inboxCount } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .gt("unread_count", 0);

      // Active campaigns (running)
      const { count: campaignCount } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .in("status", ["running", "scheduled"]);

      // Active automations with recent errors
      const { count: autoCount } = await supabase
        .from("automation_logs")
        .select("*", { count: "exact", head: true })
        .eq("status", "error")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      setBadges({
        inbox: inboxCount || 0,
        contacts: 0,
        campaigns: campaignCount || 0,
        automations: autoCount || 0,
      });
    };

    fetchBadges();

    // Subscribe to conversation changes for live inbox badge
    const channel = supabase
      .channel("sidebar-badges")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        fetchBadges();
      })
      .subscribe();

    // Refresh every 60s
    const interval = setInterval(fetchBadges, 60000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return badges;
}
