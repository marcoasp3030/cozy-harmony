import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Store, Phone, Mail, User, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const VmPayStoresTab = () => {
  const { user } = useAuth();
  const [stores, setStores] = useState<VmPayStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "vmpay_stores")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          setStores((data.value as any).stores || []);
        }
        setLoading(false);
      });
  }, [user]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("vmpay-sync", {
        body: { action: "sync_clients" },
      });
      if (error) throw error;
      if (data?.success) {
        setStores(data.stores || []);
        toast.success(`${data.stores.length} lojas importadas com sucesso!`);
      } else {
        throw new Error(data?.error || "Falha ao importar lojas");
      }
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setSyncing(false);
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Store className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="font-heading">Lojas (Clientes VMPay)</CardTitle>
                <CardDescription>
                  Lojas importadas da API VMPay. Usadas para identificar a loja quando o cliente entrar em contato.
                </CardDescription>
              </div>
            </div>
            <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sincronizar Lojas
            </Button>
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
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm truncate">{store.name}</h4>
                      <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                        ID {store.id}
                      </Badge>
                    </div>

                    {store.corporate_name && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="truncate">{store.corporate_name}</span>
                      </div>
                    )}

                    {store.cnpj && (
                      <p className="text-xs text-muted-foreground">CNPJ: {store.cnpj}</p>
                    )}

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
