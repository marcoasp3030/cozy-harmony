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

  // Call UazAPI with the documented auth header
  const callUaz = async (
    baseUrl: string,
    endpoint: string,
    headerName: string,
    token: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: Record<string, unknown>,
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [headerName]: token,
    };
    const url = `${baseUrl}${endpoint}`;
    console.log(`UazAPI ${method} ${url} [header: ${headerName}]`);
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJsonSafe(res);
    console.log(`UazAPI response: ${res.status}`, JSON.stringify(data).slice(0, 500));
    return { ok: res.ok, status: res.status, data };
  };

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
      return json({ error: 'Unauthorized', detail: claimsError?.message }, 401);
    }

    const userId = claimsData.claims.sub as string;
    const body = await req.json().catch(() => ({}));
    const { action, instanceName } = body;

    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'uazapi_config')
      .single();

    const config = (settings?.value || {}) as { baseUrl: string; adminToken: string; instanceToken: string; instanceName?: string };

    if (!config.baseUrl) {
      return json({ success: false, error: 'URL da UazAPI não configurada.' });
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    // ── CREATE INSTANCE (admin) ──────────────────────────────
    if (action === 'create-instance') {
      if (!config.adminToken) {
        return json({ success: false, error: 'Admin Token é obrigatório para criar instâncias.' });
      }

      const name = instanceName || `inst_${userId.slice(0, 8)}`;

      // UazAPI v2 docs: POST /instance/init with header "admintoken"
      const result = await callUaz(baseUrl, '/instance/init', 'admintoken', config.adminToken, 'POST', {
        instanceName: name,
      });

      if (!result.ok) {
        return json({
          success: false,
          error: `Falha ao criar instância (${result.status})`,
          debug: { endpoint: '/instance/init', header: 'admintoken', response: result.data },
        });
      }

      const d = result.data as any;
      const newToken = d?.token || d?.instance?.token || d?.data?.token || d?.hash || d?.apikey || '';
      const createdName = d?.instanceName || d?.instance?.instanceName || d?.name || name;

      // Save token + instance name
      const updatedConfig = { ...config, instanceToken: newToken || config.instanceToken, instanceName: createdName };
      await supabase
        .from('settings')
        .upsert({ user_id: userId, key: 'uazapi_config', value: updatedConfig }, { onConflict: 'user_id,key' });

      return json({ success: true, instanceToken: newToken, instanceName: createdName, data: d });
    }

    // ── Instance-level actions require instanceToken ──────────
    if (!config.instanceToken) {
      return json({ success: false, error: 'Instance Token não configurado. Crie uma instância primeiro.' });
    }

    // UazAPI v2 docs: instance endpoints use header "token"
    const tok = config.instanceToken;

    // ── TEST / STATUS ────────────────────────────────────────
    if (action === 'test') {
      const result = await callUaz(baseUrl, '/instance/status', 'token', tok, 'GET');

      if (!result.ok) {
        return json({ connected: false, error: `Status retornou ${result.status}`, debug: result.data });
      }

      return json({ connected: true, ...result.data });
    }

    // ── CONNECT ──────────────────────────────────────────────
    if (action === 'connect') {
      // UazAPI v2 docs: POST /instance/connect with header "token"
      const result = await callUaz(baseUrl, '/instance/connect', 'token', tok, 'POST', {});

      if (!result.ok) {
        return json({
          success: false,
          error: `Falha ao conectar (${result.status})`,
          debug: { endpoint: '/instance/connect', method: 'POST', header: 'token', response: result.data },
        });
      }

      const d = result.data as any;
      const qr = d?.qrcode || d?.qrCode || d?.qr || d?.base64 || d?.data?.qrcode || null;

      // If no QR in connect response, check status
      if (!qr) {
        const statusRes = await callUaz(baseUrl, '/instance/status', 'token', tok, 'GET');
        const sd = statusRes.data as any;
        const statusQr = sd?.qrcode || sd?.qrCode || sd?.qr || sd?.base64 || sd?.data?.qrcode || null;
        return json({ success: true, qrcode: statusQr, connectData: d, statusData: sd });
      }

      return json({ success: true, qrcode: qr, ...d });
    }

    // ── QRCODE ───────────────────────────────────────────────
    if (action === 'qrcode') {
      const result = await callUaz(baseUrl, '/instance/status', 'token', tok, 'GET');
      if (!result.ok) {
        return json({ success: false, error: `Falha ao obter QR (${result.status})`, debug: result.data });
      }
      const d = result.data as any;
      const qr = d?.qrcode || d?.qrCode || d?.qr || d?.base64 || d?.data?.qrcode || null;
      return json({ success: true, qrcode: qr, ...d });
    }

    // ── DISCONNECT ───────────────────────────────────────────
    if (action === 'disconnect') {
      const result = await callUaz(baseUrl, '/instance/disconnect', 'token', tok, 'POST');
      if (!result.ok) {
        return json({ success: false, error: `Falha ao desconectar (${result.status})`, debug: result.data });
      }
      return json({ success: true, ...result.data });
    }

    // ── SET WEBHOOK ────────────────────────────────────────
    if (action === 'set-webhook') {
      const { webhookUrl, events } = body;
      if (!webhookUrl) {
        return json({ success: false, error: 'webhookUrl é obrigatório.' });
      }
      const webhookEvents = events || [
        'messages', 'messages.update', 'connection', 'contacts',
        'presence', 'groups', 'chats', 'labels', 'call',
      ];
      const result = await callUaz(baseUrl, '/webhook/set', 'token', tok, 'POST', {
        url: webhookUrl,
        events: webhookEvents,
      });
      if (!result.ok) {
        return json({
          success: false,
          error: `Falha ao configurar webhook (${result.status})`,
          debug: result.data,
        });
      }
      return json({ success: true, ...result.data });
    }

    // ── GET WEBHOOK ─────────────────────────────────────────
    if (action === 'get-webhook') {
      const result = await callUaz(baseUrl, '/webhook/get', 'token', tok, 'GET');
      return json({ success: result.ok, ...result.data });
    }

    return json({ error: 'Ação inválida. Use: create-instance, test, qrcode, connect, disconnect, set-webhook, get-webhook' }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-instance error:', message);
    return json({ error: message }, 500);
  }
});
