import { useState, useEffect } from "react";
import { Wifi, WifiOff, CheckCircle2, Loader2, QrCode, Unplug, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const SettingsPage = () => {
  const { user } = useAuth();
  const [baseUrl, setBaseUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "error">("idle");
  const [connectionInfo, setConnectionInfo] = useState<{ phone?: string; name?: string } | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  // Load saved settings
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "uazapi_config")
        .single();

      if (data?.value) {
        const config = data.value as { baseUrl: string; adminToken: string; instanceToken: string };
        setBaseUrl(config.baseUrl || "");
        setAdminToken(config.adminToken || "");
        setInstanceToken(config.instanceToken || "");
      }
    };
    load();
  }, [user]);

  const saveConfig = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const config = { baseUrl: baseUrl.trim(), adminToken: adminToken.trim(), instanceToken: instanceToken.trim() };

      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "uazapi_config", value: config as any },
          { onConflict: "user_id,key" }
        );

      if (error) throw error;
      toast.success("Configurações salvas com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!baseUrl.trim() || !instanceToken.trim()) {
      toast.error("Preencha a URL e o Instance Token primeiro.");
      return;
    }

    // Save before testing
    await saveConfig();

    setTesting(true);
    setConnectionStatus("idle");
    setConnectionInfo(null);

    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "test" },
      });

      if (error) throw error;

      if (data.connected) {
        setConnectionStatus("connected");
        setConnectionInfo({ phone: data.phone, name: data.name });
        toast.success("Conexão estabelecida com sucesso!");
      } else {
        setConnectionStatus("error");
        toast.error(data.error || "Falha na conexão");
      }
    } catch (err: any) {
      setConnectionStatus("error");
      toast.error("Erro ao testar: " + (err.message || "Verifique os dados"));
    } finally {
      setTesting(false);
    }
  };

  const getQrCode = async () => {
    setLoadingQr(true);
    setQrCode(null);
    try {
      await saveConfig();

      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "connect" },
      });

      if (error) throw error;

      if (data.qrcode) {
        setQrCode(data.qrcode);
        toast.success("QR Code gerado! Escaneie com seu WhatsApp.");
      } else {
        toast.info(data.status || "Instância já conectada ou QR não disponível.");
      }
    } catch (err: any) {
      toast.error("Erro ao gerar QR: " + (err.message || "Tente novamente"));
    } finally {
      setLoadingQr(false);
    }
  };

  const disconnect = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "disconnect" },
      });

      if (error) throw error;
      setConnectionStatus("idle");
      setConnectionInfo(null);
      setQrCode(null);
      toast.success("Desconectado com sucesso.");
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie as configurações do sistema</p>
      </div>

      <Tabs defaultValue="connection" className="space-y-4">
        <TabsList>
          <TabsTrigger value="connection">Conexão UazAPI</TabsTrigger>
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="space-y-4">
          {/* API Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Credenciais UazAPI</CardTitle>
              <CardDescription>
                Configure a conexão com sua instância UazAPI
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL da Instância</Label>
                <Input
                  placeholder="https://seudominio.uazapi.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Admin Token</Label>
                <Input
                  type="password"
                  placeholder="Token de administrador"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Instance Token</Label>
                <Input
                  type="password"
                  placeholder="Token da instância"
                  value={instanceToken}
                  onChange={(e) => setInstanceToken(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveConfig} disabled={saving} variant="outline">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar
                </Button>
                <Button onClick={testConnection} disabled={testing}>
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : connectionStatus === "connected" ? (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  ) : (
                    <Wifi className="mr-2 h-4 w-4" />
                  )}
                  Testar Conexão
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Connection Status */}
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Status da Conexão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {connectionStatus === "connected" ? (
                  <div className="flex items-center gap-3 rounded-lg bg-success/10 px-4 py-3 flex-1">
                    <Wifi className="h-5 w-5 text-success" />
                    <div>
                      <p className="text-sm font-medium text-success">Conectado</p>
                      {connectionInfo?.phone && (
                        <p className="text-xs text-muted-foreground">{connectionInfo.phone}</p>
                      )}
                      {connectionInfo?.name && (
                        <p className="text-xs text-muted-foreground">{connectionInfo.name}</p>
                      )}
                    </div>
                  </div>
                ) : connectionStatus === "error" ? (
                  <div className="flex items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 flex-1">
                    <WifiOff className="h-5 w-5 text-destructive" />
                    <p className="text-sm font-medium text-destructive">Desconectado</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 flex-1">
                    <WifiOff className="h-5 w-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Status desconhecido. Teste a conexão.</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={getQrCode} disabled={loadingQr}>
                  {loadingQr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                  Gerar QR Code
                </Button>
                {connectionStatus === "connected" && (
                  <Button variant="destructive" onClick={disconnect}>
                    <Unplug className="mr-2 h-4 w-4" />
                    Desconectar
                  </Button>
                )}
              </div>

              {qrCode && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6">
                  <p className="text-sm font-medium">Escaneie o QR Code com seu WhatsApp</p>
                  <div className="rounded-lg bg-white p-4">
                    <img
                      src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code WhatsApp"
                      className="h-64 w-64"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Dados da Empresa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nome da Empresa</Label>
                <Input placeholder="Nutricar" />
              </div>
              <div className="space-y-2">
                <Label>Fuso Horário</Label>
                <Input value="America/Sao_Paulo" readOnly />
              </div>
              <Button>Salvar</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Usuários</CardTitle>
              <CardDescription>Gerencie os usuários do sistema</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Em breve...</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Webhooks</CardTitle>
              <CardDescription>Configure URLs para receber eventos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL do Webhook</Label>
                <Input placeholder="https://seu-servidor.com/webhook" />
              </div>
              <Button>Salvar</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
