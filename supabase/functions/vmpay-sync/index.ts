import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VMPAY_BASE = "https://vmpay.vertitecnologia.com.br/api/v1";

async function vmpayGet(path: string, token: string, page = 1, perPage = 1000) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${VMPAY_BASE}${path}${sep}access_token=${token}&page=${page}&per_page=${perPage}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      throw new Error(`VMPay ${path} returned ${res.status}: Not Found`);
    }
    throw new Error(`VMPay ${path} returned ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function vmpayGetAll(path: string, token: string) {
  let page = 1;
  let all: any[] = [];
  while (true) {
    const data = await vmpayGet(path, token, page, 1000);
    const items = Array.isArray(data) ? data : data?.data ?? data?.items ?? [];
    if (!items.length) break;
    all = all.concat(items);
    if (items.length < 1000) break;
    page++;
  }
  return all;
}

async function vmpayGetSafe(path: string, token: string): Promise<any[]> {
  try {
    return await vmpayGetAll(path, token);
  } catch (e) {
    console.warn(`Endpoint ${path} not available:`, e.message);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) throw new Error("Unauthorized");

    const { data: setting } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "vmpay")
      .maybeSingle();

    const vmpayToken = (setting?.value as any)?.token;
    if (!vmpayToken) throw new Error("Token VMPay não configurado");

    const body = await req.json().catch(() => ({}));
    const action = body.action || "sync";

    if (action === "test") {
      await vmpayGet("/installations", vmpayToken, 1, 1);
      return new Response(
        JSON.stringify({ success: true, message: "Conexão com VMPay OK" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "sync_clients") {
      const clients = await vmpayGetAll("/clients", vmpayToken);
      console.log(`Fetched ${clients.length} clients (stores)`);
      const stores = clients.map((c: any) => ({
        id: c.id,
        name: c.name || `Cliente ${c.id}`,
        corporate_name: c.corporate_name || null,
        cnpj: c.cnpj || c.cpf || null,
        contact_name: c.contact_name || null,
        contact_phone: c.contact_phone || null,
        contact_email: c.contact_email || null,
      }));
      await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "vmpay_stores", value: { stores, synced_at: new Date().toISOString() } },
          { onConflict: "user_id,key" }
        );
      return new Response(
        JSON.stringify({ success: true, stores }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Full sync
    console.log("Starting VMPay sync for user", user.id);

    // 1. Fetch installations
    const installations = await vmpayGetSafe("/installations", vmpayToken);
    console.log(`Fetched ${installations.length} installations`);

    const storeNames: string[] = [];
    const installationMap = new Map<number, string>();
    for (const inst of installations) {
      const name = inst.name || inst.label || `Loja ${inst.id}`;
      storeNames.push(name);
      installationMap.set(inst.id, name);
    }

    // 2. Fetch machines
    const machines = await vmpayGetSafe("/machines", vmpayToken);
    console.log(`Fetched ${machines.length} machines`);

    // 3. Collect products from planograms using correct endpoint:
    // GET /machines/{machine_id}/installations/{installation_id}/planograms
    const allProducts: Map<string, any> = new Map();

    for (const machine of machines) {
      const installationId = machine.installation_id;
      if (!installationId) {
        console.warn(`Machine ${machine.id} has no installation_id, skipping planograms`);
        continue;
      }

      const planogramPath = `/machines/${machine.id}/installations/${installationId}/planograms`;
      try {
        const planograms = await vmpayGetAll(planogramPath, vmpayToken);
        console.log(`Machine ${machine.id}/Installation ${installationId}: ${planograms.length} planograms`);

        for (const plan of planograms) {
          const items = plan.items || plan.planogram_items || [];
          for (const item of items) {
            const product = item.product || item;
            const productId = product.id || item.product_id;
            if (!productId) continue;

            const name = product.name || item.name || `Produto ${productId}`;
            const price = item.current_price ?? item.price ?? product.price ?? 0;
            const barcode = product.barcode || product.ean || item.barcode || null;
            const storeName = installationMap.get(installationId) || null;
            const category = product.category?.name || product.category || storeName;

            allProducts.set(String(productId), {
              name,
              price: Number(price) / 100,
              barcode,
              category,
              vmpay_id: String(productId),
            });
          }
        }
      } catch (e) {
        console.warn(`Error fetching planograms ${planogramPath}:`, e.message);
      }
    }

    // 3b. Try fetching products directly as fallback
    const directProducts = await vmpayGetSafe("/products", vmpayToken);
    console.log(`Fetched ${directProducts.length} direct products`);
    for (const p of directProducts) {
      const id = String(p.id);
      if (!allProducts.has(id)) {
        allProducts.set(id, {
          name: p.name || `Produto ${id}`,
          price: Number(p.price || 0) / 100,
          barcode: p.barcode || p.ean || null,
          category: p.category?.name || p.category || null,
          vmpay_id: id,
        });
      }
    }

    // 4. Upsert products into the products table
    const productsArray = Array.from(allProducts.values());
    let upserted = 0;
    let errors = 0;

    console.log(`Total products to upsert: ${productsArray.length}`);

    for (const prod of productsArray) {
      let existingId: string | null = null;

      if (prod.barcode) {
        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("user_id", user.id)
          .eq("barcode", prod.barcode)
          .maybeSingle();
        existingId = existing?.id || null;
      }

      if (!existingId) {
        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("user_id", user.id)
          .ilike("name", prod.name)
          .maybeSingle();
        existingId = existing?.id || null;
      }

      const record = {
        user_id: user.id,
        name: prod.name,
        price: prod.price,
        barcode: prod.barcode,
        category: prod.category,
        is_active: true,
      };

      if (existingId) {
        const { error } = await supabase.from("products").update(record).eq("id", existingId);
        if (error) { errors++; console.error("Update error:", error); }
        else upserted++;
      } else {
        const { error } = await supabase.from("products").insert(record);
        if (error) { errors++; console.error("Insert error:", error); }
        else upserted++;
      }
    }

    // 5. Save sync metadata
    await supabase
      .from("settings")
      .upsert(
        {
          user_id: user.id,
          key: "vmpay_sync",
          value: {
            last_sync: new Date().toISOString(),
            installations: installations.length,
            machines: machines.length,
            products: productsArray.length,
            stores: storeNames,
            upserted,
            errors,
          },
        },
        { onConflict: "user_id,key" }
      );

    return new Response(
      JSON.stringify({
        success: true,
        installations: installations.length,
        machines: machines.length,
        products: productsArray.length,
        stores: storeNames,
        upserted,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("VMPay sync error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
