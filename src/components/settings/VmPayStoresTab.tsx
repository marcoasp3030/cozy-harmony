import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Store, Phone, Mail, User, Building2, Plus, X, Save, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface VmPayStore {
  id: number;
  name: string;
  corporate_name: string | null;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

type AliasMap = Record<string, string[]>; // store name → aliases

const VmPayStoresTab = () => {
  const { user } = useAuth();
  const [stores, setStores] = useState<VmPayStore[]>([]);
  const [aliases, setAliases] = useState<AliasMap>({});
  const [newAlias, setNewAlias] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingAliases, setSavingAliases] = useState(false);
  const [aliasChanged, setAliasChanged] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("settings").select("value").eq("user_id", user.id).eq("key", "vmpay_stores").maybeSingle(),
      supabase.from("settings").select("value").eq("user_id", user.id).eq("key", "vmpay_store_aliases").maybeSingle(),
    ]).then(([storesRes, aliasRes]) => {
      if (storesRes.data?.value) setStores((storesRes.data.value as any).stores || []);
      if (aliasRes.data?.value) setAliases((aliasRes.data.value as any) || {});
      setLoading(false);
    });
  }, [user]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("vmpay-sync", { body: { action: "sync_clients" } });
      if (error) throw error;
      if (data?.success) {
        setStores(data.stores || []);
        toast.success(`${data.stores.length} lojas importadas com sucesso!`);
      } else throw new Error(data?.error || "Falha ao importar lojas");
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setSyncing(false);
    }
  };

  const addAlias = (storeName: string) => {
    const alias = (newAlias[storeName] || "").trim().toLowerCase();
    if (!alias) return;
    const current = aliases[storeName] || [];
    if (current.includes(alias)) {
      toast.error("Apelido já existe para esta loja");
      return;
    }
    setAliases({ ...aliases, [storeName]: [...current, alias] });
    setNewAlias({ ...newAlias, [storeName]: "" });
    setAliasChanged(true);
  };

  const removeAlias = (storeName: string, alias: string) => {
    const current = aliases[storeName] || [];
    setAliases({ ...aliases, [storeName]: current.filter((a) => a !== alias) });
    setAliasChanged(true);
  };

  const saveAliases = async () => {
    if (!user) return;
    setSavingAliases(true);
    try {
      // Clean empty arrays
      const cleaned: AliasMap = {};
      for (const [k, v] of Object.entries(aliases)) {
        if (v.length > 0) cleaned[k] = v;
      }
      const { error } = await supabase
        .from("settings")
        .upsert({ user_id: user.id, key: "vmpay_store_aliases", value: cleaned as any }, { onConflict: "user_id,key" });
      if (error) throw error;
      setAliasChanged(false);
      toast.success("Apelidos salvos com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSavingAliases(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Store className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="font-heading">Lojas (Clientes VMPay)</CardTitle>
                <CardDescription>
                  Lojas importadas da API VMPay. Adicione apelidos para cada loja para facilitar a identificação automática.
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              {aliasChanged && (
                <Button onClick={saveAliases} disabled={savingAliases} size="sm">
                  {savingAliases ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar Apelidos
                </Button>
              )}
              <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sincronizar Lojas
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma loja importada. Clique em "Sincronizar Lojas" para importar.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stores.map((store) => (
                <Card key={store.id} className="border-border/50">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm truncate">{store.name}</h4>
                      <Badge variant="secondary" className="text-xs shrink-0 ml-2">ID {store.id}</Badge>
                    </div>

                    {store.corporate_name && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="truncate">{store.corporate_name}</span>
                      </div>
                    )}
                    {store.cnpj && <p className="text-xs text-muted-foreground">CNPJ: {store.cnpj}</p>}
                    {store.contact_name && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="h-3 w-3 shrink-0" />
                        <span>{store.contact_name}</span>
                      </div>
                    )}
                    {store.contact_phone && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{store.contact_phone}</span>
                      </div>
                    )}
                    {store.contact_email && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{store.contact_email}</span>
                      </div>
                    )}

                    {/* Alias section */}
                    <div className="border-t border-border/50 pt-2 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        Apelidos
                      </div>
                      {(aliases[store.name] || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(aliases[store.name] || []).map((alias) => (
                            <Badge key={alias} variant="outline" className="text-xs gap-1 pr-1">
                              {alias}
                              <button onClick={() => removeAlias(store.name, alias)} className="ml-0.5 hover:text-destructive">
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1">
                        <Input
                          placeholder="ex: t5, tamb5..."
                          value={newAlias[store.name] || ""}
                          onChange={(e) => setNewAlias({ ...newAlias, [store.name]: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && addAlias(store.name)}
                          className="h-7 text-xs"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => addAlias(store.name)}
                          disabled={!(newAlias[store.name] || "").trim()}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VmPayStoresTab;
