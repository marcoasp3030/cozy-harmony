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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const jwtToken = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(jwtToken);
    if (claimsError || !claimsData?.claims) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const userId = claimsData.claims.sub as string;
    const body = await req.json();
    const { action, campaignId } = body;

    if (!campaignId) {
      return json({ error: 'campaignId é obrigatório.' }, 400);
    }

    // Load campaign
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campErr || !campaign) {
      return json({ error: 'Campanha não encontrada.' }, 404);
    }

    // ── PAUSE ────────────────────────────────────────────────
    if (action === 'pause') {
      if (campaign.status !== 'running') {
        return json({ error: 'Campanha não está em execução.' });
      }
      await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaignId);
      return json({ success: true, status: 'paused' });
    }

    // ── START / RESUME ───────────────────────────────────────
    if (action === 'start' || action === 'resume') {
      const allowedStatuses = ['draft', 'scheduled', 'paused'];
      if (!allowedStatuses.includes(campaign.status)) {
        return json({ error: `Campanha com status "${campaign.status}" não pode ser iniciada.` });
      }

      // Get UazAPI config
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'uazapi_config')
        .single();

      if (!settings?.value) {
        return json({ error: 'UazAPI não configurada.' });
      }

      const config = settings.value as { baseUrl: string; instanceToken: string };
      const baseUrl = config.baseUrl.replace(/\/+$/, '');

      // Mark campaign as running
      const updates: Record<string, unknown> = { status: 'running' };
      if (!campaign.started_at) updates.started_at = new Date().toISOString();
      await supabase.from('campaigns').update(updates).eq('id', campaignId);

      // Get pending contacts (batch of 50 to stay within edge function timeout)
      const BATCH_SIZE = 50;
      const { data: pendingContacts } = await supabase
        .from('campaign_contacts')
        .select('id, phone, variables')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .limit(BATCH_SIZE);

      if (!pendingContacts || pendingContacts.length === 0) {
        // No more pending — mark completed
        await supabase.from('campaigns').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', campaignId);
        return json({ success: true, status: 'completed', processed: 0 });
      }

      const messageType = campaign.message_type || 'text';
      const messageContent = campaign.message_content || '';
      const mediaUrl = campaign.media_url || '';
      const delayMs = (campaign.settings as any)?.delay || 2000;

      let sent = 0;
      let failed = 0;

      for (const contact of pendingContacts) {
        // Check if campaign was paused mid-execution
        if (sent > 0 && sent % 10 === 0) {
          const { data: freshCampaign } = await supabase
            .from('campaigns')
            .select('status')
            .eq('id', campaignId)
            .single();
          if (freshCampaign?.status === 'paused') {
            break;
          }
        }

        // Replace variables in message
        let text = messageContent;
        if (contact.variables && typeof contact.variables === 'object') {
          const vars = contact.variables as Record<string, string>;
          for (const [key, value] of Object.entries(vars)) {
            text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
          }
        }

        // Build send body
        const cleanNumber = String(contact.phone).replace(/\D/g, '');
        const sendBody: Record<string, unknown> = { number: cleanNumber };

        switch (messageType) {
          case 'text':
            sendBody.text = text;
            break;
          case 'image':
          case 'video':
            sendBody.mediaUrl = mediaUrl;
            if (text) sendBody.caption = text;
            break;
          case 'audio':
          case 'ptt':
            sendBody.mediaUrl = mediaUrl;
            break;
          case 'document':
            sendBody.mediaUrl = mediaUrl;
            if (text) sendBody.caption = text;
            break;
          default:
            sendBody.text = text;
        }

        try {
          const sendUrl = `${baseUrl}/send/${messageType}`;
          console.log(`Sending to: ${sendUrl}`, JSON.stringify(sendBody));
          const res = await fetch(sendUrl, {
            method: 'POST',
            headers: {
              'token': config.instanceToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(sendBody),
          });

          const resText = await res.text();
          console.log(`Response ${res.status}: ${resText.slice(0, 500)}`);
          const resData = (() => { try { return JSON.parse(resText); } catch { return { raw: resText }; } })();

          if (res.ok && resData.error === undefined) {
            sent++;
            await supabase.from('campaign_contacts').update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              message_id: resData.key?.id || resData.messageId || null,
            }).eq('id', contact.id);
          } else {
            failed++;
            await supabase.from('campaign_contacts').update({
              status: 'failed',
              error: resData.error || `HTTP ${res.status}`,
            }).eq('id', contact.id);
          }
        } catch (err) {
          failed++;
          await supabase.from('campaign_contacts').update({
            status: 'failed',
            error: err instanceof Error ? err.message : 'Erro de rede',
          }).eq('id', contact.id);
        }

        // Delay between messages
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      // Update campaign stats
      const { data: statsData } = await supabase
        .from('campaign_contacts')
        .select('status')
        .eq('campaign_id', campaignId);

      const stats = {
        total: statsData?.length || 0,
        sent: statsData?.filter((c) => c.status === 'sent').length || 0,
        delivered: statsData?.filter((c) => c.status === 'delivered').length || 0,
        read: statsData?.filter((c) => c.status === 'read').length || 0,
        failed: statsData?.filter((c) => c.status === 'failed').length || 0,
      };
      const pending = statsData?.filter((c) => c.status === 'pending').length || 0;

      const newStatus = pending === 0 ? 'completed' : 'running';
      const campaignUpdate: Record<string, unknown> = { stats };
      if (newStatus === 'completed') {
        campaignUpdate.status = 'completed';
        campaignUpdate.completed_at = new Date().toISOString();
      }
      await supabase.from('campaigns').update(campaignUpdate).eq('id', campaignId);

      return json({
        success: true,
        status: newStatus,
        processed: sent + failed,
        sent,
        failed,
        remaining: pending,
        stats,
      });
    }

    return json({ error: 'Ação inválida. Use: start, resume, pause' }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('campaign-execute error:', message);
    return json({ error: message }, 500);
  }
});
