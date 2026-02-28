import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find campaigns that are scheduled and due
    const now = new Date().toISOString();
    const { data: dueCampaigns, error: fetchErr } = await supabase
      .from("campaigns")
      .select("id, name, scheduled_at, settings")
      .eq("status", "scheduled")
      .lte("scheduled_at", now);

    if (fetchErr) {
      console.error("Error fetching due campaigns:", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!dueCampaigns || dueCampaigns.length === 0) {
      console.log("No campaigns due for execution.");
      return new Response(JSON.stringify({ executed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${dueCampaigns.length} campaigns due for execution.`);

    const results = [];

    for (const campaign of dueCampaigns) {
      console.log(`Executing campaign: ${campaign.name} (${campaign.id})`);

      try {
        // Call campaign-execute to start the campaign
        const execRes = await fetch(
          `${supabaseUrl}/functions/v1/campaign-execute`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              action: "start",
              campaignId: campaign.id,
            }),
          },
        );

        const execData = await execRes.json();
        console.log(`Campaign ${campaign.id} result:`, JSON.stringify(execData).slice(0, 300));

        // Handle recurrence: schedule next occurrence
        const recurrence = campaign.settings?.recurrence;
        if (recurrence && campaign.scheduled_at) {
          const baseDate = new Date(campaign.scheduled_at);
          let nextDate: Date;

          switch (recurrence.type) {
            case "daily":
              nextDate = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
              break;
            case "weekly":
              nextDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
              break;
            case "monthly":
              nextDate = new Date(baseDate);
              nextDate.setMonth(nextDate.getMonth() + 1);
              break;
            default:
              nextDate = baseDate;
          }

          // Create a new campaign for the next occurrence
          const { data: origContacts } = await supabase
            .from("campaign_contacts")
            .select("contact_id, phone, variables")
            .eq("campaign_id", campaign.id);

          const { data: newCamp } = await supabase
            .from("campaigns")
            .insert({
              name: campaign.name,
              scheduled_at: nextDate.toISOString(),
              status: "scheduled",
              settings: campaign.settings,
              stats: {
                total: origContacts?.length || 0,
                sent: 0,
                delivered: 0,
                read: 0,
                failed: 0,
              },
            })
            .select("id")
            .single();

          if (newCamp && origContacts && origContacts.length > 0) {
            const rows = origContacts.map((c: any) => ({
              campaign_id: newCamp.id,
              contact_id: c.contact_id,
              phone: c.phone,
              variables: c.variables,
              status: "pending",
            }));
            await supabase.from("campaign_contacts").insert(rows);
          }

          console.log(`Recurring campaign scheduled for ${nextDate.toISOString()}`);
        }

        results.push({ id: campaign.id, status: "executed" });
      } catch (execErr: any) {
        console.error(`Error executing campaign ${campaign.id}:`, execErr);
        results.push({ id: campaign.id, status: "error", error: execErr.message });
      }
    }

    return new Response(JSON.stringify({ executed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Scheduler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
