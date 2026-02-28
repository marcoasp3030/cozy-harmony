import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── META BEST PRACTICES DEFAULTS ─────────────────────────────
const DEFAULT_SETTINGS = {
  // Delay range in ms between messages (randomized to avoid pattern detection)
  delayMin: 3000,
  delayMax: 8000,
  // Max messages per batch (edge function timeout safety)
  batchSize: 30,
  // Daily sending limit (Meta recommends gradual ramp-up)
  dailyLimit: 200,
  // Business hours only (Meta flags off-hours mass sends)
  businessHoursOnly: true,
  businessHourStart: 8, // 8 AM
  businessHourEnd: 20,  // 8 PM
  // Warm-up mode: gradually increases daily volume for new numbers
  warmUpEnabled: false,
  warmUpDayLimit: 50,   // Start with 50/day, increase gradually
  // Pause between batches (seconds) — gives WhatsApp servers breathing room
  batchCooldownSec: 15,
  // Random variation in message content (append invisible chars to avoid duplicate detection)
  contentVariation: true,
  // Max consecutive failures before auto-pausing (protects number quality)
  maxConsecutiveFailures: 5,
  // Timezone offset for business hours calculation
  timezoneOffset: -3, // BRT (UTC-3)
};

/** Random integer between min and max (inclusive) */
const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Adds subtle invisible variation to prevent duplicate message detection */
const varyContent = (text: string): string => {
  // Append 1-3 zero-width spaces at random positions
  const zwChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
  const count = randomBetween(1, 3);
  let result = text;
  for (let i = 0; i < count; i++) {
    const char = zwChars[randomBetween(0, zwChars.length - 1)];
    const pos = randomBetween(0, result.length);
    result = result.slice(0, pos) + char + result.slice(pos);
  }
  return result;
};

/** Check if current time is within business hours */
const isBusinessHours = (settings: typeof DEFAULT_SETTINGS): boolean => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const localHour = (utcHour + settings.timezoneOffset + 24) % 24;
  return localHour >= settings.businessHourStart && localHour < settings.businessHourEnd;
};

/** Get how many messages were sent today for this campaign's owner */
const getTodaySentCount = async (supabase: any, userId: string): Promise<number> => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('campaign_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', todayStart.toISOString());

  return count || 0;
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

    // Merge settings with defaults
    const campaignSettings = {
      ...DEFAULT_SETTINGS,
      ...((campaign.settings as Record<string, unknown>) || {}),
    };

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

      // ── BUSINESS HOURS CHECK ──────────────────────────────
      if (campaignSettings.businessHoursOnly && !isBusinessHours(campaignSettings)) {
        return json({
          error: `Envio permitido apenas em horário comercial (${campaignSettings.businessHourStart}h - ${campaignSettings.businessHourEnd}h). Agende a campanha ou desative a restrição.`,
          code: 'OUTSIDE_BUSINESS_HOURS',
        });
      }

      // ── DAILY LIMIT CHECK ─────────────────────────────────
      const todaySent = await getTodaySentCount(supabase, userId);
      const effectiveLimit = campaignSettings.warmUpEnabled
        ? campaignSettings.warmUpDayLimit
        : campaignSettings.dailyLimit;

      if (todaySent >= effectiveLimit) {
        return json({
          error: `Limite diário atingido (${todaySent}/${effectiveLimit} mensagens). ` +
            (campaignSettings.warmUpEnabled
              ? 'O modo warm-up limita envios para proteger seu número. Retome amanhã.'
              : 'Retome amanhã para manter a saúde do número.'),
          code: 'DAILY_LIMIT_REACHED',
          todaySent,
          dailyLimit: effectiveLimit,
        });
      }

      const remainingToday = effectiveLimit - todaySent;

      // Get UazAPI config - prefer instance_id from campaign, then default instance, then legacy
      let config: { baseUrl: string; instanceToken: string } | null = null;

      if (campaign.instance_id) {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('base_url, instance_token')
          .eq('id', campaign.instance_id)
          .single();
        if (inst) config = { baseUrl: (inst as any).base_url, instanceToken: (inst as any).instance_token };
      }

      if (!config) {
        const { data: instances } = await supabase
          .from('whatsapp_instances')
          .select('base_url, instance_token')
          .eq('user_id', userId)
          .order('is_default', { ascending: false })
          .limit(1);
        if (instances && instances.length > 0) {
          const inst = instances[0] as any;
          config = { baseUrl: inst.base_url, instanceToken: inst.instance_token };
        }
      }

      if (!config) {
        // Legacy fallback
        const { data: settings } = await supabase
          .from('settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'uazapi_config')
          .single();
        if (settings?.value) {
          const v = settings.value as any;
          config = { baseUrl: v.baseUrl, instanceToken: v.instanceToken };
        }
      }

      if (!config) {
        return json({ error: 'UazAPI não configurada.' });
      }
      const baseUrl = config.baseUrl.replace(/\/+$/, '');

      // Mark campaign as running
      const updates: Record<string, unknown> = { status: 'running' };
      if (!campaign.started_at) updates.started_at = new Date().toISOString();
      await supabase.from('campaigns').update(updates).eq('id', campaignId);

      // ── BATCH SIZE (respects daily limit remaining) ────────
      const batchSize = Math.min(
        campaignSettings.batchSize,
        remainingToday,
      );

      const { data: pendingContacts } = await supabase
        .from('campaign_contacts')
        .select('id, phone, variables')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .limit(batchSize);

      if (!pendingContacts || pendingContacts.length === 0) {
        await supabase.from('campaigns').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', campaignId);
        return json({ success: true, status: 'completed', processed: 0 });
      }

      const messageType = campaign.message_type || 'text';
      const messageContent = campaign.message_content || '';
      const mediaUrl = campaign.media_url || '';

      let sent = 0;
      let failed = 0;
      let consecutiveFailures = 0;
      let autoPaused = false;

      for (const contact of pendingContacts) {
        // ── CHECK PAUSE MID-EXECUTION ────────────────────────
        if (sent > 0 && sent % 10 === 0) {
          const { data: freshCampaign } = await supabase
            .from('campaigns')
            .select('status')
            .eq('id', campaignId)
            .single();
          if (freshCampaign?.status === 'paused') break;
        }

        // ── AUTO-PAUSE ON CONSECUTIVE FAILURES ──────────────
        if (consecutiveFailures >= campaignSettings.maxConsecutiveFailures) {
          autoPaused = true;
          await supabase.from('campaigns').update({
            status: 'paused',
            settings: {
              ...campaignSettings,
              _autoPausedReason: `Auto-pausada após ${consecutiveFailures} falhas consecutivas. Verifique o status do número.`,
              _autoPausedAt: new Date().toISOString(),
            } as any,
          }).eq('id', campaignId);
          console.warn(`Campaign ${campaignId} auto-paused: ${consecutiveFailures} consecutive failures`);
          break;
        }

        // ── BUSINESS HOURS RE-CHECK (long-running batches) ──
        if (campaignSettings.businessHoursOnly && sent > 0 && sent % 15 === 0) {
          if (!isBusinessHours(campaignSettings)) {
            await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaignId);
            autoPaused = true;
            break;
          }
        }

        // ── REPLACE VARIABLES ────────────────────────────────
        let text = messageContent;
        if (contact.variables && typeof contact.variables === 'object') {
          const vars = contact.variables as Record<string, string>;
          for (const [key, value] of Object.entries(vars)) {
            text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
          }
        }

        // ── CONTENT VARIATION (anti-duplicate detection) ─────
        if (campaignSettings.contentVariation && messageType === 'text') {
          text = varyContent(text);
        }

        // ── BUILD SEND BODY ──────────────────────────────────
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
          const res = await fetch(sendUrl, {
            method: 'POST',
            headers: {
              'token': config.instanceToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(sendBody),
          });

          const resText = await res.text();
          const resData = (() => { try { return JSON.parse(resText); } catch { return { raw: resText }; } })();

          console.log(`Send response for ${cleanNumber}:`, JSON.stringify(resData).slice(0, 500));

          // Extract message ID from various UazAPI response formats:
          // { key: { id: "3EB0..." } }
          // { messageid: "3EB0..." }
          // { messageId: "3EB0..." }
          // { id: "5511...:3EB0..." }
          // { message: { key: { id: "3EB0..." } } }
          // { data: { key: { id: "3EB0..." } } }
          const extractMsgId = (d: any): string | null => {
            if (!d) return null;
            return d.messageid || d.messageId || d.key?.id ||
              d.message?.key?.id || d.data?.key?.id ||
              d.message?.id || d.data?.id || d.id || null;
          };

          const normalizeMsgId = (value: unknown): string | null => {
            if (!value) return null;
            const raw = String(value).trim();
            if (!raw) return null;
            const parts = raw.split(':').filter(Boolean);
            return parts.length > 1 ? parts[parts.length - 1] : raw;
          };

          const messageId = normalizeMsgId(extractMsgId(resData));

          if (res.ok && resData.error === undefined) {
            sent++;
            consecutiveFailures = 0;
            await supabase.from('campaign_contacts').update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              message_id: messageId,
            }).eq('id', contact.id);
            console.log(`Sent to ${cleanNumber}, message_id: ${messageId}`);
          } else {
            failed++;
            consecutiveFailures++;
            await supabase.from('campaign_contacts').update({
              status: 'failed',
              error: resData.error || `HTTP ${res.status}`,
            }).eq('id', contact.id);
          }
        } catch (err) {
          failed++;
          consecutiveFailures++;
          await supabase.from('campaign_contacts').update({
            status: 'failed',
            error: err instanceof Error ? err.message : 'Erro de rede',
          }).eq('id', contact.id);
        }

        // ── RANDOMIZED DELAY (anti-pattern detection) ────────
        const delay = randomBetween(campaignSettings.delayMin, campaignSettings.delayMax);
        await new Promise((r) => setTimeout(r, delay));
      }

      // ── UPDATE CAMPAIGN STATS ──────────────────────────────
      const { data: statsData } = await supabase
        .from('campaign_contacts')
        .select('status')
        .eq('campaign_id', campaignId);

      const stats = {
        total: statsData?.length || 0,
        sent: statsData?.filter((c: any) => ['sent', 'delivered', 'read'].includes(c.status)).length || 0,
        delivered: statsData?.filter((c: any) => ['delivered', 'read'].includes(c.status)).length || 0,
        read: statsData?.filter((c: any) => c.status === 'read').length || 0,
        failed: statsData?.filter((c: any) => c.status === 'failed').length || 0,
      };
      const pending = statsData?.filter((c: any) => c.status === 'pending').length || 0;

      const newStatus = autoPaused ? 'paused' : pending === 0 ? 'completed' : 'running';
      const campaignUpdate: Record<string, unknown> = { stats };
      if (newStatus === 'completed') {
        campaignUpdate.status = 'completed';
        campaignUpdate.completed_at = new Date().toISOString();
      } else if (autoPaused) {
        campaignUpdate.status = 'paused';
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
        autoPaused,
        autoPausedReason: autoPaused
          ? consecutiveFailures >= campaignSettings.maxConsecutiveFailures
            ? `Auto-pausada: ${consecutiveFailures} falhas consecutivas`
            : 'Auto-pausada: fora do horário comercial'
          : undefined,
        cooldownSec: pending > 0 && !autoPaused ? campaignSettings.batchCooldownSec : 0,
      });
    }

    return json({ error: 'Ação inválida. Use: start, resume, pause' }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('campaign-execute error:', message);
    return json({ error: message }, 500);
  }
});
