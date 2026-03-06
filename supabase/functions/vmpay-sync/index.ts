import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VMPAY_BASE = "https://vmpay.vertitecnologia.com.br/api/v1";

async function vmpayGet(path: string, token: string, page = 1, perPage = 1000) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${VMPAY_BASE}${path}${sep}access_token=${token}&page=${page}&per_page=${perPage}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VMPay ${path} returned ${res.status}: ${text}`);
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

    // Get user from JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) throw new Error("Unauthorized");

    // Get VMPay token from settings
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
      // Just test the connection
      const installations = await vmpayGet("/installations", vmpayToken, 1, 1);
      return new Response(
        JSON.stringify({ success: true, message: "Conexão com VMPay OK" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Full sync
    console.log("Starting VMPay sync for user", user.id);

    // 1. Fetch installations (stores)
    const installations = await vmpayGetAll("/installations", vmpayToken);
    console.log(`Fetched ${installations.length} installations`);

    // 2. For each installation, fetch machines and their planograms
    const allProducts: Map<string, any> = new Map();
    const storeNames: string[] = [];
    let machineCount = 0;

    for (const inst of installations) {
      const storeName = inst.name || inst.label || `Loja ${inst.id}`;
      storeNames.push(storeName);

      // Fetch machines for this installation
      try {
        const machines = await vmpayGetAll(`/installations/${inst.id}/machines`, vmpayToken);
        machineCount += machines.length;

        for (const machine of machines) {
          // Fetch planograms (product assignments) for each machine
          try {
            const planograms = await vmpayGetAll(
              `/machines/${machine.id}/planograms`,
              vmpayToken
            );

            for (const plan of planograms) {
              // Each planogram has items with product info
              const items = plan.items || plan.planogram_items || [];
              for (const item of items) {
                const product = item.product || item;
                const productId = product.id || item.product_id;
                if (!productId) continue;

                const name = product.name || item.name || `Produto ${productId}`;
                const price = item.current_price ?? item.price ?? product.price ?? 0;
                const barcode = product.barcode || product.ean || item.barcode || null;
                const category = product.category?.name || product.category || storeName;

                allProducts.set(String(productId), {
                  name,
                  price: Number(price) / 100, // VMPay usually stores in cents
                  barcode,
                  category,
                  vmpay_id: String(productId),
                });
              }
            }
          } catch (e) {
            console.warn(`Error fetching planograms for machine ${machine.id}:`, e.message);
          }
        }
      } catch (e) {
        console.warn(`Error fetching machines for installation ${inst.id}:`, e.message);
      }
    }

    // 3. Also try fetching products directly (some VMPay setups have this)
    try {
      const directProducts = await vmpayGetAll("/products", vmpayToken);
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
    } catch (e) {
      console.log("Direct products endpoint not available:", e.message);
    }

    // 4. Upsert products into the products table
    const productsArray = Array.from(allProducts.values());
    let upserted = 0;
    let errors = 0;

    for (const prod of productsArray) {
      // Try to find existing product by barcode or name
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
        const { error } = await supabase
          .from("products")
          .update(record)
          .eq("id", existingId);
        if (error) { errors++; console.error("Update error:", error); }
        else upserted++;
      } else {
        const { error } = await supabase
          .from("products")
          .insert(record);
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
            machines: machineCount,
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
        machines: machineCount,
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
