import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Load inactivity settings from any user who configured it
    const { data: settings } = await supabase
      .from('settings')
      .select('value, user_id')
      .eq('key', 'inactivity_auto_close')
      .limit(10);

    if (!settings || settings.length === 0) {
      return json({ success: true, message: 'No inactivity settings configured', closed: 0 });
    }

    let totalClosed = 0;

    for (const setting of settings) {
      const config = setting.value as any;
      if (!config?.enabled || !config?.hours || config.hours < 1) continue;

      const thresholdDate = new Date(Date.now() - config.hours * 60 * 60 * 1000).toISOString();

      // Find conversations that are open/in_progress/waiting and last activity before threshold
      const { data: staleConversations } = await supabase
        .from('conversations')
        .select('id, contact_id, last_message_at')
        .eq('user_id', setting.user_id)
        .in('status', ['open', 'in_progress', 'waiting'])
        .lt('last_message_at', thresholdDate)
        .limit(100);

      if (!staleConversations || staleConversations.length === 0) continue;

      console.log(`Found ${staleConversations.length} stale conversations for user ${setting.user_id} (threshold: ${config.hours}h)`);

      for (const conv of staleConversations) {
        // Close the conversation
        await supabase
          .from('conversations')
          .update({
            status: 'resolved',
            funnel_stage_id: null,
            funnel_id: null,
          })
          .eq('id', conv.id);

        // Send close message if configured
        if (config.closeMessage && conv.contact_id) {
          try {
            // Get contact info
            const { data: contact } = await supabase
              .from('contacts')
              .select('phone, name')
              .eq('id', conv.contact_id)
              .single();

            if (contact?.phone) {
              // Get WhatsApp instance
              const { data: instances } = await supabase
                .from('whatsapp_instances')
                .select('base_url, instance_token, is_default')
                .eq('user_id', setting.user_id)
                .limit(5);

              const instance = (instances || []).find((i: any) => i.is_default) || instances?.[0];

              if (instance?.base_url && instance?.instance_token) {
                let closeText = config.closeMessage;
                closeText = closeText.replace(/\{\{nome\}\}/gi, contact.name || 'cliente');

                const apiBase = String(instance.base_url).replace(/\/+$/, '');
                const jid = contact.phone.includes('@') ? contact.phone : `${contact.phone}@s.whatsapp.net`;

                await fetch(`${apiBase}/send/text`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'token': instance.instance_token,
                  },
                  body: JSON.stringify({ phone: jid, message: closeText }),
                });

                // Save the message in DB
                await supabase.from('messages').insert({
                  contact_id: conv.contact_id,
                  direction: 'outbound',
                  type: 'text',
                  content: closeText,
                  status: 'sent',
                  user_id: setting.user_id,
                  metadata: { auto_close: true },
                });

                console.log(`Sent close message to ${contact.phone} for conversation ${conv.id}`);
              }
            }
          } catch (sendErr) {
            console.error(`Failed to send close message for conv ${conv.id}:`, sendErr);
          }
        }

        totalClosed++;
      }
    }

    console.log(`Auto-close complete. Total closed: ${totalClosed}`);
    return json({ success: true, closed: totalClosed });
  } catch (err) {
    console.error('Auto-close error:', err);
    return json({ success: false, error: String(err) }, 500);
  }
});
