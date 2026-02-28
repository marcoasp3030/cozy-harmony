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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = user.id;
    const body = await req.json();
    const { action, instanceName } = body;

    // Get user's UazAPI settings from DB
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'uazapi_config')
      .single();

    const config = (settings?.value || {}) as { baseUrl: string; adminToken: string; instanceToken: string };

    if (!config.baseUrl) {
      return new Response(JSON.stringify({ error: 'URL da UazAPI não configurada.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    // Action: create-instance — uses adminToken to create a new instance and auto-save instanceToken
    if (action === 'create-instance') {
      if (!config.adminToken) {
        return new Response(JSON.stringify({ error: 'Admin Token é obrigatório para criar instâncias.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const name = instanceName || `inst_${userId.slice(0, 8)}`;

      const res = await fetch(`${baseUrl}/instance/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instanceName: name }),
      });
      const data = await res.json();

      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Erro ao criar instância: ${res.status}`, details: data }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Auto-save the instance token returned by the API
      const newToken = data.token || data.instanceToken || data.hash || data.apikey || '';
      if (newToken) {
        const updatedConfig = { ...config, instanceToken: newToken };
        await supabase
          .from('settings')
          .upsert(
            { user_id: userId, key: 'uazapi_config', value: updatedConfig },
            { onConflict: 'user_id,key' }
          );
      }

      return new Response(JSON.stringify({ success: true, instanceToken: newToken, ...data }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For other actions, instanceToken is required
    if (!config.instanceToken) {
      return new Response(JSON.stringify({ error: 'Instance Token não configurado. Crie uma instância primeiro.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'test') {
      const res = await fetch(`${baseUrl}/instance/status`, {
        headers: { 'Authorization': `Bearer ${config.instanceToken}` },
      });
      const data = await res.json();

      if (!res.ok) {
        return new Response(JSON.stringify({ connected: false, error: `API retornou status ${res.status}` }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ connected: true, ...data }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'qrcode') {
      const res = await fetch(`${baseUrl}/instance/qrcode`, {
        headers: { 'Authorization': `Bearer ${config.instanceToken}` },
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'connect') {
      const res = await fetch(`${baseUrl}/instance/connect`, {
        headers: { 'Authorization': `Bearer ${config.instanceToken}` },
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'disconnect') {
      const res = await fetch(`${baseUrl}/instance/disconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.instanceToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      return new Response(JSON.stringify({ error: 'Ação inválida. Use: create-instance, test, qrcode, connect, disconnect' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-instance error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
