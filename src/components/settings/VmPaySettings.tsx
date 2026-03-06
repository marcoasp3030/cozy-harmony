import { useState, useEffect } from "react";
import { Save, Loader2, Eye, EyeOff, CheckCircle2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const VmPaySettings = () => {
  const { user } = useAuth();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "vmpay")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          const val = data.value as any;
          setToken(val.token || "");
          setLoaded(true);
        }
        setLoading(false);
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "vmpay", value: { token: token.trim() } as any },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      setLoaded(true);
      toast.success("Configuração da VMPay salva com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const maskKey = (k: string) =>
    k.length > 8 ? k.slice(0, 4) + "••••••••" + k.slice(-4) : "••••••••";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-primary" />
          <div>
            <CardTitle className="font-heading">VMPay</CardTitle>
            <CardDescription>
              Integre com a API da VMPay para importar lojas, produtos e valores automaticamente.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Token da API *</Label>
          <div className="relative">
            <Input
              type={showToken ? "text" : "password"}
              placeholder="Insira o token da API VMPay"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            O token pode ser obtido no painel administrativo da VMPay
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving || !token.trim()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar Configuração
        </Button>

        {loaded && token && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Configurado — Token: {maskKey(token)}
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
          <p className="text-sm font-medium">Dados importados da VMPay:</p>
          <div className="flex flex-wrap gap-1.5">
            {["Lojas", "Produtos", "Preços"].map((item) => (
              <span key={item} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary font-medium">
                {item}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Após configurar o token, os dados de lojas e produtos serão sincronizados automaticamente.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default VmPaySettings;
