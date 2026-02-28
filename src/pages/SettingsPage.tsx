import { useState, useEffect } from "react";
import { Wifi, WifiOff, CheckCircle2, Loader2, QrCode, Unplug, Save, Plus, Link2, ExternalLink, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Extract a readable error message from edge function response */
const extractError = (data: any, fallback: string): string => {
  if (!data) return fallback;
  const detail = data.details
    ? typeof data.details === "string"
      ? data.details
      : JSON.stringify(data.details, null, 2)
    : "";
  const debug = data.debug
    ? typeof data.debug === "string"
      ? data.debug
      : JSON.stringify(data.debug, null, 2)
    : "";
  const mainError = data.error || data.message || "";
  const extra = detail || debug;
  return extra ? `${mainError}\n\nDetalhes: ${extra}` : mainError || fallback;
};

const WEBHOOK_URL = `https://wszmgoerulwkwhensevl.supabase.co/functions/v1/uazapi-webhook`;

const WebhookConfig = () => {
  const [configuring, setConfiguring] = useState(false);
  const [currentWebhook, setCurrentWebhook] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("uazapi-instance", {
          body: { action: "get-webhook" },
        });
        if (!error && data?.url) {
          setCurrentWebhook(data.url);
        }
      } catch {}
      setLoadingStatus(false);
    };
    load();
  }, []);

  const configureWebhook = async () => {
    setConfiguring(true);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: {
          action: "set-webhook",
          webhookUrl: WEBHOOK_URL,
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(extractError(data, "Erro ao configurar webhook"), { duration: 8000 });
      } else {
        setCurrentWebhook(WEBHOOK_URL);
        toast.success("Webhook configurado com sucesso! Mensagens recebidas aparecerão no Inbox.");
      }
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setConfiguring(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isConfigured = currentWebhook === WEBHOOK_URL;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Webhook de Mensagens</CardTitle>
        <CardDescription>
          Configure o webhook na UazAPI para receber mensagens em tempo real no Inbox
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Webhook URL */}
        <div className="space-y-2">
          <Label>URL do Webhook</Label>
          <div className="flex gap-2">
            <Input value={WEBHOOK_URL} readOnly className="flex-1 font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyUrl} title="Copiar URL">
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Esta é a URL que receberá os eventos da UazAPI (mensagens, status, etc.)
          </p>
        </div>

        {/* Status */}
        <div className="space-y-2">
          <Label>Status</Label>
          {loadingStatus ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando...
            </div>
          ) : isConfigured ? (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div>
                <p className="text-sm font-medium text-success">Webhook configurado</p>
                <p className="text-xs text-muted-foreground">Mensagens recebidas aparecerão automaticamente no Inbox</p>
              </div>
            </div>
          ) : currentWebhook ? (
            <div className="flex items-center gap-2 rounded-lg bg-warning/10 px-4 py-3">
              <Link2 className="h-5 w-5 text-warning" />
              <div>
                <p className="text-sm font-medium text-warning">Webhook apontando para outra URL</p>
                <p className="text-xs text-muted-foreground font-mono break-all">{currentWebhook}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3">
              <WifiOff className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Webhook não configurado</p>
            </div>
          )}
        </div>

        {/* Action Button */}
        <Button onClick={configureWebhook} disabled={configuring || isConfigured}>
          {configuring ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : isConfigured ? (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" />
          )}
          {isConfigured ? "Webhook Ativo" : "Configurar Webhook Automaticamente"}
        </Button>

        {/* Info */}
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
          <p className="text-sm font-medium">Eventos monitorados:</p>
          <div className="flex flex-wrap gap-1.5">
            {["messages", "messages.update", "connection", "contacts", "presence", "groups", "chats"].map((evt) => (
              <span key={evt} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary font-medium">
                {evt}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const SettingsPage = () => {
  const { user } = useAuth();
  const [baseUrl, setBaseUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "error">("idle");
  const [connectionInfo, setConnectionInfo] = useState<{ phone?: string; name?: string } | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState(false);

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
        const config = data.value as { baseUrl: string; adminToken: string; instanceToken: string; instanceName?: string };
        setBaseUrl(config.baseUrl || "");
        setAdminToken(config.adminToken || "");
        setInstanceToken(config.instanceToken || "");
        setInstanceName(config.instanceName || "");
      }
    };
    load();
  }, [user]);

  const markTouched = (field: string) => setTouched((p) => ({ ...p, [field]: true }));

  const isValidUrl = (url: string) => {
    try {
      const u = new URL(url.trim());
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  };

  const errors = {
    baseUrl: touched.baseUrl && !baseUrl.trim() ? "URL é obrigatória" : touched.baseUrl && !isValidUrl(baseUrl) ? "URL inválida (ex: https://dominio.uazapi.com)" : "",
    adminToken: touched.adminToken && !adminToken.trim() ? "Admin Token é obrigatório" : "",
    instanceToken: touched.instanceToken && !instanceToken.trim() ? "Instance Token é obrigatório" : "",
  };

  const saveConfig = async () => {
    if (!user) return;
    setTouched({ baseUrl: true, adminToken: true, instanceToken: true });
    if (!baseUrl.trim() || !isValidUrl(baseUrl)) {
      toast.error("URL da instância inválida.");
      return;
    }
    setSaving(true);
    try {
      const config = {
        baseUrl: baseUrl.trim(),
        adminToken: adminToken.trim(),
        instanceToken: instanceToken.trim(),
        instanceName: instanceName.trim(),
      };

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
        toast.error(extractError(data, "Falha na conexão"), { duration: 8000 });
      }
    } catch (err: any) {
      setConnectionStatus("error");
      toast.error("Erro ao testar: " + (err.message || "Verifique os dados"), { duration: 8000 });
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
      } else if (data.error) {
        toast.error(extractError(data, "Erro ao gerar QR"), { duration: 8000 });
      } else {
        toast.info(data.status || "Instância já conectada ou QR não disponível.");
      }
    } catch (err: any) {
      toast.error("Erro ao gerar QR: " + (err.message || "Tente novamente"), { duration: 8000 });
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
      if (data.error) {
        toast.error(extractError(data, "Erro ao desconectar"), { duration: 8000 });
        return;
      }
      setQrCode(null);
      toast.success("Desconectado com sucesso.");
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    }
  };

  const createInstance = async () => {
    if (!baseUrl.trim() || !adminToken.trim()) {
      toast.error("Preencha a URL e o Admin Token para criar uma instância.");
      return;
    }
    await saveConfig();
    setCreatingInstance(true);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "create-instance", instanceName: instanceName.trim() || undefined },
      });
      if (error) throw error;
      if (data.instanceToken) {
        setInstanceToken(data.instanceToken);
        if (data.instanceName) setInstanceName(data.instanceName);
        toast.success("Instância criada! Token preenchido automaticamente.");
      } else if (data.error) {
        toast.error(extractError(data, "Erro ao criar instância"), { duration: 8000 });
      } else {
        toast.info("Instância criada, mas nenhum token retornado. Verifique o painel da UazAPI.");
      }
    } catch (err: any) {
      toast.error("Erro ao criar instância: " + (err.message || "Tente novamente"), { duration: 8000 });
    } finally {
      setCreatingInstance(false);
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
                <Label className={errors.baseUrl ? "text-destructive" : ""}>URL da Instância *</Label>
                <Input
                  placeholder="https://seudominio.uazapi.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onBlur={() => markTouched("baseUrl")}
                  className={errors.baseUrl ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {errors.baseUrl && <p className="text-xs text-destructive">{errors.baseUrl}</p>}
              </div>
              <div className="space-y-2">
                <Label className={errors.adminToken ? "text-destructive" : ""}>Admin Token *</Label>
                <Input
                  type="password"
                  placeholder="Token de administrador"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                  onBlur={() => markTouched("adminToken")}
                  className={errors.adminToken ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {errors.adminToken && <p className="text-xs text-destructive">{errors.adminToken}</p>}
              </div>
              <div className="space-y-2">
                <Label>Nome da Instância</Label>
                <Input
                  placeholder="Nome para identificar a instância (ex: atendimento)"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Usado ao criar uma nova instância. Deixe vazio para gerar automaticamente.</p>
              </div>
              <div className="space-y-2">
                <Label className={errors.instanceToken ? "text-destructive" : ""}>Instance Token *</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Token da instância (ou crie automaticamente)"
                    value={instanceToken}
                    onChange={(e) => setInstanceToken(e.target.value)}
                    onBlur={() => markTouched("instanceToken")}
                    className={`flex-1 ${errors.instanceToken ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  <Button variant="outline" onClick={createInstance} disabled={creatingInstance} title="Criar instância e gerar token automaticamente">
                    {creatingInstance ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
                {errors.instanceToken ? (
                  <p className="text-xs text-destructive">{errors.instanceToken}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Preencha manualmente ou clique em + para criar uma instância usando o Admin Token.</p>
                )}
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
          <WebhookConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
