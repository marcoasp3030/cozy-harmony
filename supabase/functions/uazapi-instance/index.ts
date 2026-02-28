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

  const parseJsonSafe = async (res: Response) => {
    const raw = await res.text();
    try { return raw ? JSON.parse(raw) : null; } catch { return { raw }; }
  };

  const callUaz = async (
    baseUrl: string, endpoint: string, headerName: string, token: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: Record<string, unknown>,
  ) => {
    const url = `${baseUrl}${endpoint}`;
    console.log(`UazAPI ${method} ${url} [header: ${headerName}]`);
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', [headerName]: token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJsonSafe(res);
    console.log(`UazAPI response: ${res.status}`, JSON.stringify(data).slice(0, 500));
    return { ok: res.ok, status: res.status, data };
  };

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const jwtToken = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(jwtToken);
    if (claimsError || !claimsData?.claims) return json({ error: 'Unauthorized' }, 401);

    const userId = claimsData.claims.sub as string;
    const body = await req.json().catch(() => ({}));
    const { action, instanceName, instanceId } = body;

    // ── RESOLVE GLOBAL CONFIG (uazapi_global from settings) ──
    let globalBaseUrl = '';
    let globalAdminToken = '';
    const { data: globalSettings } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'uazapi_global')
      .single();
    if (globalSettings?.value) {
      const gv = globalSettings.value as any;
      globalBaseUrl = gv.baseUrl || '';
      globalAdminToken = gv.adminToken || '';
    }

    // ── RESOLVE CONFIG: from whatsapp_instances table or legacy settings ──
    let config: { baseUrl: string; adminToken: string; instanceToken: string; instanceName?: string } = {
      baseUrl: '', adminToken: '', instanceToken: '',
    };

    if (instanceId) {
      // Load specific instance
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('id', instanceId)
        .eq('user_id', userId)
        .single();
      if (inst) {
        config = {
          baseUrl: (inst as any).base_url || globalBaseUrl,
          adminToken: (inst as any).admin_token || globalAdminToken,
          instanceToken: (inst as any).instance_token || '',
          instanceName: (inst as any).instance_name || '',
        };
      }
    } else {
      // Try default instance from new table first
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .limit(1);

      if (instances && instances.length > 0) {
        const inst = instances[0] as any;
        config = {
          baseUrl: inst.base_url || globalBaseUrl,
          adminToken: inst.admin_token || globalAdminToken,
          instanceToken: inst.instance_token || '',
          instanceName: inst.instance_name || '',
        };
      } else {
        // Legacy fallback: settings table
        const { data: settings } = await supabase
          .from('settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'uazapi_config')
          .single();
        if (settings?.value) {
          const v = settings.value as any;
          config = {
            baseUrl: v.baseUrl || globalBaseUrl,
            adminToken: v.adminToken || globalAdminToken,
            instanceToken: v.instanceToken || '',
            instanceName: v.instanceName || '',
          };
        }
      }
    }

    // Fallback to global config if instance had no base_url
    if (!config.baseUrl) config.baseUrl = globalBaseUrl;
    if (!config.adminToken) config.adminToken = globalAdminToken;

    if (!config.baseUrl) return json({ success: false, error: 'URL da UazAPI não configurada.' });

    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    // ── CREATE INSTANCE ──
    if (action === 'create-instance') {
      if (!config.adminToken) return json({ success: false, error: 'Admin Token é obrigatório para criar instâncias.' });
      const name = instanceName || `inst_${userId.slice(0, 8)}`;
      const result = await callUaz(baseUrl, '/instance/init', 'admintoken', config.adminToken, 'POST', { Name: name, instanceName: name, name: name });
      if (!result.ok) return json({ success: false, error: `Falha ao criar instância (${result.status})`, debug: result.data });

      const d = result.data as any;
      const newToken = d?.token || d?.instance?.token || d?.data?.token || d?.hash || d?.apikey || '';
      const createdName = d?.instanceName || d?.instance?.instanceName || d?.name || name;

      // Update instance in whatsapp_instances table if instanceId provided
      if (instanceId) {
        await supabase.from('whatsapp_instances').update({
          instance_token: newToken || config.instanceToken,
          instance_name: createdName,
        } as any).eq('id', instanceId);
      }

      return json({ success: true, instanceToken: newToken, instanceName: createdName, data: d });
    }

    // Reload instance token from DB if empty (may have been updated by create-instance)
    if (!config.instanceToken && instanceId) {
      const { data: freshInst } = await supabase
        .from('whatsapp_instances')
        .select('instance_token')
        .eq('id', instanceId)
        .single();
      if (freshInst && (freshInst as any).instance_token) {
        config.instanceToken = (freshInst as any).instance_token;
      }
    }

    if (!config.instanceToken) return json({ success: false, error: 'Instance Token não configurado.' });
    const tok = config.instanceToken;

    // ── TEST ──
    if (action === 'test') {
      const result = await callUaz(baseUrl, '/instance/status', 'token', tok, 'GET');
      if (!result.ok) return json({ connected: false, error: `Status retornou ${result.status}`, debug: result.data });
      return json({ connected: true, ...result.data });
    }

    // ── CONNECT ──
    if (action === 'connect') {
      const result = await callUaz(baseUrl, '/instance/connect', 'token', tok, 'POST', {});
      if (!result.ok) return json({ success: false, error: `Falha ao conectar (${result.status})`, debug: result.data });
      const d = result.data as any;
      const qr = d?.qrcode || d?.qrCode || d?.qr || d?.base64 || d?.data?.qrcode || d?.instance?.qrcode || null;
      if (!qr) {
        const statusRes = await callUaz(baseUrl, '/instance/status', 'token', tok, 'GET');
        const sd = statusRes.data as any;
        const statusQr = sd?.qrcode || sd?.qrCode || sd?.qr || sd?.base64 || sd?.data?.qrcode || sd?.instance?.qrcode || null;
        return json({ success: true, qrcode: statusQr, connectData: d, statusData: sd });
      }
      return json({ success: true, qrcode: qr, ...d });
    }

    // ── QRCODE ──
    if (action === 'qrcode') {
      const result = await callUaz(baseUrl, '/instance/status', 'token', tok, 'GET');
      if (!result.ok) return json({ success: false, error: `Falha ao obter QR (${result.status})`, debug: result.data });
      const d = result.data as any;
      const qr = d?.qrcode || d?.qrCode || d?.qr || d?.base64 || d?.data?.qrcode || d?.instance?.qrcode || null;
      return json({ success: true, qrcode: qr, ...d });
    }

    // ── DISCONNECT ──
    if (action === 'disconnect') {
      const result = await callUaz(baseUrl, '/instance/disconnect', 'token', tok, 'POST');
      if (!result.ok) return json({ success: false, error: `Falha ao desconectar (${result.status})`, debug: result.data });
      return json({ success: true, ...result.data });
    }

    // ── SET WEBHOOK ──
    if (action === 'set-webhook') {
      const { webhookUrl, events } = body;
      if (!webhookUrl) return json({ success: false, error: 'webhookUrl é obrigatório.' });
      const webhookEvents = events || ['messages', 'messages_update', 'connection', 'contacts', 'presence', 'groups', 'chats', 'labels', 'call'];
      const result = await callUaz(baseUrl, '/webhook', 'token', tok, 'POST', { url: webhookUrl, events: webhookEvents, excludeMessages: ['wasSentByApi'] });
      if (!result.ok) return json({ success: false, error: `Falha ao configurar webhook (${result.status})`, debug: result.data });
      return json({ success: true, ...result.data });
    }

    // ── GET WEBHOOK ──
    if (action === 'get-webhook') {
      const result = await callUaz(baseUrl, '/webhook', 'token', tok, 'GET');
      return json({ success: result.ok, ...result.data });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-instance error:', message);
    return json({ error: message }, 500);
  }
});
