import { useState, useEffect } from "react";
import { Save, Loader2, Eye, EyeOff, CheckCircle2, ShoppingCart, RefreshCw, Wifi, Store, Package, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import VmPayStoresTab from "./VmPayStoresTab";

interface SyncMeta {
  last_sync: string;
  installations: number;
  machines: number;
  products: number;
  stores: string[];
  upserted: number;
  errors: number;
}

const VmPaySettings = () => {
  const { user } = useAuth();
  const [token, setToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("settings").select("value").eq("user_id", user.id).eq("key", "vmpay").maybeSingle(),
      supabase.from("settings").select("value").eq("user_id", user.id).eq("key", "vmpay_sync").maybeSingle(),
    ]).then(([tokenRes, syncRes]) => {
      if (tokenRes.data?.value) {
        const val = tokenRes.data.value as any;
        setToken(val.token || "");
        setMachineId(val.machine_id || "");
        setInstallationId(val.installation_id || "");
        setLoaded(true);
      }
      if (syncRes.data?.value) setSyncMeta(syncRes.data.value as any);
      setLoading(false);
    });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert({ user_id: user.id, key: "vmpay", value: { token: token.trim(), machine_id: machineId.trim(), installation_id: installationId.trim() } as any }, { onConflict: "user_id,key" });
      if (error) throw error;
      setLoaded(true);
      toast.success("Configuração da VMPay salva com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("vmpay-sync", { body: { action: "test" } });
      if (error) throw error;
      if (data?.success) toast.success("✅ Conexão com VMPay OK!");
      else throw new Error(data?.error || "Falha na conexão");
    } catch (err: any) {
      toast.error("Falha na conexão: " + (err.message || "Verifique o token"));
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("vmpay-sync", { body: { action: "sync" } });
      if (error) throw error;
      if (data?.success) {
        toast.success(`Sincronização concluída! ${data.installations} lojas, ${data.products} produtos importados.`);
        setSyncMeta({
          last_sync: new Date().toISOString(),
          installations: data.installations,
          machines: data.machines,
          products: data.products,
          stores: data.stores,
          upserted: data.upserted,
          errors: data.errors,
        });
      } else throw new Error(data?.error || "Falha na sincronização");
    } catch (err: any) {
      toast.error("Erro na sincronização: " + (err.message || "Tente novamente"));
    } finally {
      setSyncing(false);
    }
  };

  const maskKey = (k: string) => (k.length > 8 ? k.slice(0, 4) + "••••••••" + k.slice(-4) : "••••••••");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="config" className="space-y-4">
      <TabsList>
        <TabsTrigger value="config">Configuração</TabsTrigger>
        <TabsTrigger value="stores" disabled={!loaded}>Lojas</TabsTrigger>
      </TabsList>

      <TabsContent value="config" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShoppingCart className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="font-heading">VMPay</CardTitle>
                <CardDescription>Integre com a API da VMPay para importar lojas, produtos e valores.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Token da API *</Label>
              <div className="relative">
                <Input type={showToken ? "text" : "password"} placeholder="Insira o token da API VMPay" value={token} onChange={(e) => setToken(e.target.value)} />
                <button type="button" onClick={() => setShowToken(!showToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">O token pode ser obtido no painel administrativo da VMPay</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving || !token.trim()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              {loaded && token && (
                <>
                  <Button variant="outline" onClick={handleTest} disabled={testing}>
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                    Testar Conexão
                  </Button>
                  <Button variant="secondary" onClick={handleSync} disabled={syncing}>
                    {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Sincronizar Produtos
                  </Button>
                </>
              )}
            </div>

            {loaded && token && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configurado — Token: {maskKey(token)}
              </div>
            )}
          </CardContent>
        </Card>

        {syncMeta && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                Última Sincronização
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{syncMeta.installations}</span>
                  <span className="text-sm text-muted-foreground">lojas</span>
                </div>
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{syncMeta.products}</span>
                  <span className="text-sm text-muted-foreground">produtos</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{syncMeta.upserted}</span>
                  <span className="text-sm text-muted-foreground">salvos</span>
                </div>
                {syncMeta.errors > 0 && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-medium">{syncMeta.errors}</span>
                    <span className="text-sm text-muted-foreground">erros</span>
                  </div>
                )}
              </div>
              {syncMeta.stores?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Lojas importadas:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {syncMeta.stores.map((store) => (
                      <Badge key={store} variant="secondary" className="text-xs">{store}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Sincronizado em: {new Date(syncMeta.last_sync).toLocaleString("pt-BR")}
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="stores">
        <VmPayStoresTab />
      </TabsContent>
    </Tabs>
  );
};

export default VmPaySettings;
