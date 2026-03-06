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

function toNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const str = String(value).trim();
  if (!str) return 0;

  let normalized = str;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(",", ".");
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function normalizePrice(raw: any): number {
  const n = toNumber(raw);
  if (!n || n <= 0) return 0;
  if (Number.isInteger(n) && n >= 100) return n / 100;
  return n;
}

function extractPrice(...candidates: any[]): number {
  for (const candidate of candidates) {
    const price = normalizePrice(candidate);
    if (price > 0) return price;
  }
  return 0;
}

function isPlaceholderName(name: string | null | undefined, id: string): boolean {
  if (!name) return true;
  const clean = name.trim();
  return clean === "" || clean === `Produto ${id}` || /^\d+$/.test(clean);
}

function firstNonEmpty(...values: any[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
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
    const configMachineId = (setting?.value as any)?.machine_id?.toString().trim();
    const configInstallationId = (setting?.value as any)?.installation_id?.toString().trim();
    console.log(`Config: token=${!!vmpayToken}, machine_id="${configMachineId}", installation_id="${configInstallationId}"`);
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

    // Debug: log first machine structure to understand fields
    if (machines.length > 0) {
      console.log("First machine keys:", JSON.stringify(Object.keys(machines[0])));
      console.log("First machine sample:", JSON.stringify(machines[0]).substring(0, 500));
    }

    // 3. Collect products from planograms
    const allProducts: Map<string, any> = new Map();
    const machineInstallationPairs: Array<{machineId: number, installationId: number}> = [];

    // Priority 1: Use user-configured machine_id and installation_id
    if (configMachineId && configInstallationId) {
      console.log(`Using configured machine_id=${configMachineId}, installation_id=${configInstallationId}`);
      machineInstallationPairs.push({ machineId: Number(configMachineId), installationId: Number(configInstallationId) });
    } else {
      // Fallback: try to extract from machine objects
      for (const machine of machines) {
        const instId = machine.installation_id
          || machine.installation?.id
          || machine.current_installation_id
          || machine.current_installation?.id;
        if (instId) {
          machineInstallationPairs.push({ machineId: machine.id, installationId: instId });
        }
      }
      console.log(`Found ${machineInstallationPairs.length} machine-installation pairs from machine data`);

      // Last resort: iterate all installations × machines
      if (machineInstallationPairs.length === 0 && installations.length > 0 && machines.length > 0) {
        console.log("No installation_id in machines. Trying all installation × machine combinations...");
        for (const inst of installations) {
          for (const machine of machines) {
            machineInstallationPairs.push({ machineId: machine.id, installationId: inst.id });
          }
        }
        console.log(`Generated ${machineInstallationPairs.length} combinations to try`);
      }
    }

    let planogramsFetched = 0;
    let sampleLogged = false;
    for (const pair of machineInstallationPairs) {
      const planogramPath = `/machines/${pair.machineId}/installations/${pair.installationId}/planograms`;
      try {
        const planograms = await vmpayGetAll(planogramPath, vmpayToken);
        if (!planograms.length) continue;
        planogramsFetched++;
        console.log(`Machine ${pair.machineId}/Installation ${pair.installationId}: ${planograms.length} planograms`);

        for (const plan of planograms) {
          const items = plan.items || plan.planogram_items || [];
          for (const item of items) {
            const good = item.good || item.product || {};
            const productId = good.id || item.good_id || item.product_id || item.id;
            if (!productId) continue;

            const id = String(productId);
            const name = firstNonEmpty(good.name, good.title, good.description, item.name, item.label, `Produto ${id}`) || `Produto ${id}`;
            const price = extractPrice(
              item.desired_price,
              item.typed_desired_price,
              item.typed_promotional_price,
              item.typed_benefits_club_price,
              item.default_desired_price,
              item.current_price,
              item.price,
              good.desired_price,
              good.price,
              good.current_price,
            );
            const barcode = firstNonEmpty(good.barcode, good.ean, good.gtin, good.ean13, item.barcode, item.ean);
            const storeName = installationMap.get(pair.installationId) || null;
            const category = firstNonEmpty(good.category?.name, good.category, item.category?.name, item.category, storeName);

            if (!sampleLogged) {
              console.log("Sample item:", JSON.stringify({ id, name, price, desired_price: item.desired_price, typed_desired_price: item.typed_desired_price, good_name: good?.name, good_barcode: good?.barcode }));
              sampleLogged = true;
            }

            allProducts.set(id, {
              name,
              price,
              barcode,
              category,
              vmpay_id: id,
            });
          }
        }
      } catch (_e) {
        // Silently skip invalid combinations
      }
    }
    console.log(`Planograms fetched successfully from ${planogramsFetched} pairs, ${allProducts.size} unique products`);

    // 3b. Fetch products and merge details (name/barcode/price/category)
    const directProducts = await vmpayGetSafe("/products", vmpayToken);
    console.log(`Fetched ${directProducts.length} direct products`);
    for (const p of directProducts) {
      const id = String(p.id);
      const existing = allProducts.get(id);

      const directName = firstNonEmpty(p.name, p.title, p.description, p.label, `Produto ${id}`) || `Produto ${id}`;
      const directPrice = extractPrice(
        p.current_price,
        p.sale_price,
        p.selling_price,
        p.price,
        p.price_cents,
        p.price_in_cents,
        p.value,
        p.amount,
      );
      const directBarcode = firstNonEmpty(p.barcode, p.ean, p.gtin, p.ean13);
      const directCategory = firstNonEmpty(p.category?.name, p.category);

      if (!existing) {
        allProducts.set(id, {
          name: directName,
          price: directPrice,
          barcode: directBarcode,
          category: directCategory,
          vmpay_id: id,
        });
        continue;
      }

      allProducts.set(id, {
        ...existing,
        name: isPlaceholderName(existing.name, id) ? directName : existing.name,
        price: existing.price > 0 ? existing.price : directPrice,
        barcode: existing.barcode || directBarcode,
        category: existing.category || directCategory,
      });
    }

    // 4. Upsert products into the products table (batch, fast)
    const productsArray = Array.from(allProducts.values()).filter((p) => !!p?.vmpay_id);
    let upserted = 0;
    let errors = 0;

    console.log(`Total products to upsert: ${productsArray.length}`);

    const { data: existingProducts, error: existingError } = await supabase
      .from("products")
      .select("id,name,barcode,price")
      .eq("user_id", user.id);

    if (existingError) throw existingError;

    const existingByBarcode = new Map<string, { id: string; price: number }>();
    const existingByName = new Map<string, { id: string; price: number }>();

    for (const row of existingProducts || []) {
      const rowPrice = Number(row.price || 0);
      if (row.barcode) {
        existingByBarcode.set(String(row.barcode).trim(), { id: row.id, price: rowPrice });
      }
      existingByName.set(String(row.name).trim().toLowerCase(), { id: row.id, price: rowPrice });
    }

    const payload = productsArray.map((prod) => {
      const id = String(prod.vmpay_id);
      const barcode = firstNonEmpty(prod.barcode) || null;
      const name = firstNonEmpty(prod.name, `Produto ${id}`) || `Produto ${id}`;
      const category = firstNonEmpty(prod.category) || null;
      const incomingPrice = toNumber(prod.price);

      const byBarcode = barcode ? existingByBarcode.get(barcode) : null;
      const byName = existingByName.get(name.trim().toLowerCase()) || null;
      const existing = byBarcode || byName;
      const finalPrice = incomingPrice > 0 ? incomingPrice : (existing?.price || 0);

      return {
        id: existing?.id,
        user_id: user.id,
        name,
        price: finalPrice,
        barcode,
        category,
        is_active: true,
      };
    });

    const chunkSize = 500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase.from("products").upsert(chunk, { onConflict: "id" });
      if (error) {
        console.error("Batch upsert error:", error);
        errors += chunk.length;
      } else {
        upserted += chunk.length;
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
