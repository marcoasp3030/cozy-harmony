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

  const parseJsonSafe = async (res: Response) => {
    const raw = await res.text();
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return { raw };
    }
  };

  const authModes = [
    'bearer',
    'raw-authorization',
    'token-header',
    'token-lower-header',
    'admintoken-header',
    'apikey-header',
    'x-api-key',
  ] as const;

  const callUazApi = async ({
    baseUrl,
    endpoints,
    token,
    method = 'GET',
    body,
  }: {
    baseUrl: string;
    endpoints: string[];
    token: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
  }) => {
    const attempts: Array<{
      endpoint: string;
      method: string;
      auth_mode: string;
      status: number;
      response: unknown;
    }> = [];

    for (const endpoint of endpoints) {
      for (const mode of authModes) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (mode === 'bearer') headers['Authorization'] = `Bearer ${token}`;
        if (mode === 'raw-authorization') headers['Authorization'] = token;
        if (mode === 'token-header') headers['Token'] = token;
        if (mode === 'token-lower-header') headers['token'] = token;
        if (mode === 'admintoken-header') headers['admintoken'] = token;
        if (mode === 'apikey-header') headers['apikey'] = token;
        if (mode === 'x-api-key') headers['x-api-key'] = token;

        const res = await fetch(`${baseUrl}${endpoint}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        const data = await parseJsonSafe(res);
        attempts.push({ endpoint, method, auth_mode: mode, status: res.status, response: data });

        if (res.ok) {
          return {
            ok: true,
            status: res.status,
            data,
            details: { attempts },
          };
        }
      }
    }

    const last = attempts[attempts.length - 1];
    return {
      ok: false,
      status: last?.status ?? 500,
      data: last?.response ?? null,
      details: { attempts },
    };
  };

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized', detail: claimsError?.message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const config = (settings?.value || {}) as { baseUrl: string; adminToken: string; instanceToken: string };

    if (!config.baseUrl) {
      return new Response(JSON.stringify({ success: false, error: 'URL da UazAPI não configurada.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    if (action === 'create-instance') {
      if (!config.adminToken) {
        return new Response(JSON.stringify({ success: false, error: 'Admin Token é obrigatório para criar instâncias.' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const name = instanceName || `inst_${userId.slice(0, 8)}`;
      const result = await callUazApi({
        baseUrl,
        endpoints: ['/instance/init', '/instance/create', '/instance'],
        token: config.adminToken,
        method: 'POST',
        body: { name, instanceName: name, systemName: 'api' },
      });

      if (!result.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: `Falha ao criar instância (${result.status})`,
          details: result.details,
          response: result.data,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = result.data as any;
      const newToken =
        data?.token ||
        data?.instanceToken ||
        data?.hash ||
        data?.apikey ||
        data?.instance?.token ||
        data?.data?.token ||
        '';

      if (newToken) {
        const updatedConfig = { ...config, instanceToken: newToken };
        await supabase
          .from('settings')
          .upsert(
            { user_id: userId, key: 'uazapi_config', value: updatedConfig },
            { onConflict: 'user_id,key' }
          );
      }

      return new Response(JSON.stringify({ success: true, instanceToken: newToken, data, details: result.details }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!config.instanceToken) {
      return new Response(JSON.stringify({ success: false, error: 'Instance Token não configurado. Crie uma instância primeiro.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'test') {
      const result = await callUazApi({
        baseUrl,
        endpoints: ['/instance/status', '/instance/info'],
        token: config.instanceToken,
        method: 'GET',
      });

      if (!result.ok) {
        return new Response(JSON.stringify({ connected: false, error: `Falha ao consultar status (${result.status})`, details: result.details, response: result.data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ connected: true, ...result.data, details: result.details }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'connect') {
      // UazAPI v2 docs: POST /instance/connect (token header)
      const connectResult = await callUazApi({
        baseUrl,
        endpoints: ['/instance/connect'],
        token: config.instanceToken,
        method: 'POST',
        body: {},
      });

      if (!connectResult.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: `Falha ao conectar instância (${connectResult.status})`,
          details: connectResult.details,
          response: connectResult.data,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const connectData = connectResult.data as any;
      const connectQr =
        connectData?.qrcode ||
        connectData?.qrCode ||
        connectData?.qr ||
        connectData?.base64 ||
        connectData?.data?.qrcode ||
        connectData?.instance?.qrcode ||
        null;

      // If connect response does not carry QR, read from status endpoint
      if (!connectQr) {
        const statusResult = await callUazApi({
          baseUrl,
          endpoints: ['/instance/status'],
          token: config.instanceToken,
          method: 'GET',
        });

        const statusData = statusResult.data as any;
        const statusQr =
          statusData?.qrcode ||
          statusData?.qrCode ||
          statusData?.qr ||
          statusData?.base64 ||
          statusData?.data?.qrcode ||
          statusData?.instance?.qrcode ||
          statusData?.status?.qrcode ||
          null;

        return new Response(JSON.stringify({
          success: true,
          qrcode: statusQr,
          connectData,
          statusData,
          details: {
            connectAttempts: connectResult.details?.attempts || [],
            statusAttempts: statusResult.details?.attempts || [],
          },
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        qrcode: connectQr,
        ...connectData,
        details: connectResult.details,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'qrcode') {
      // UazAPI v2: QR is typically returned in /instance/status while connecting
      const result = await callUazApi({
        baseUrl,
        endpoints: ['/instance/status'],
        token: config.instanceToken,
        method: 'GET',
      });

      if (!result.ok) {
        return new Response(JSON.stringify({ success: false, error: `Falha ao obter QR (${result.status})`, details: result.details, response: result.data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = result.data as any;
      const qr =
        data?.qrcode ||
        data?.qrCode ||
        data?.qr ||
        data?.base64 ||
        data?.data?.qrcode ||
        data?.instance?.qrcode ||
        data?.status?.qrcode ||
        null;

      return new Response(JSON.stringify({ success: true, qrcode: qr, ...data, details: result.details }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'disconnect') {
      const result = await callUazApi({
        baseUrl,
        endpoints: ['/instance/disconnect', '/instance/logout'],
        token: config.instanceToken,
        method: 'POST',
      });

      if (!result.ok) {
        return new Response(JSON.stringify({ success: false, error: `Falha ao desconectar (${result.status})`, details: result.details, response: result.data }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, ...result.data, details: result.details }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Ação inválida. Use: create-instance, test, qrcode, connect, disconnect' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-instance error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
