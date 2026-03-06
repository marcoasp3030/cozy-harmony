import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Verify caller is admin
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser();
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check admin role
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle();

  if (roleData?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Apenas administradores podem excluir usuários' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { user_id } = await req.json();

  if (!user_id) {
    return new Response(JSON.stringify({ error: 'user_id é obrigatório' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Prevent self-deletion
  if (user_id === caller.id) {
    return new Response(JSON.stringify({ error: 'Você não pode excluir seu próprio usuário' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Clean up related data
  await supabase.from('attendant_instances').delete().eq('attendant_user_id', user_id);
  await supabase.from('attendant_supervisors').delete().eq('attendant_user_id', user_id);
  await supabase.from('attendant_supervisors').delete().eq('supervisor_user_id', user_id);
  await supabase.from('user_roles').delete().eq('user_id', user_id);
  await supabase.from('profiles').delete().eq('user_id', user_id);

  // Delete from auth
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user_id);

  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
