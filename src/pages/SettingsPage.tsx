import { useState, useEffect, useCallback } from "react";
import { Wifi, WifiOff, CheckCircle2, Loader2, QrCode, Unplug, Save, Plus, Link2, ExternalLink, Copy, Check, Volume2, VolumeX, Brain, Eye, EyeOff, Sparkles, FileText, Image, Mic, Video, MessageSquare, Wrench, RefreshCw, Smartphone, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
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
        if (!error && data) {
          // Response is an array of webhooks or a single object
          const webhooks = Array.isArray(data) ? data : (data.success === false ? [] : [data]);
          const found = webhooks.find((w: any) => w.url);
          if (found) setCurrentWebhook(found.url);
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

const NotificationSoundToggle = () => {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem("notification_sound_enabled");
    return stored !== "false"; // default true
  });

  const toggle = (checked: boolean) => {
    setEnabled(checked);
    localStorage.setItem("notification_sound_enabled", String(checked));
    toast.success(checked ? "Som de notificação ativado" : "Som de notificação desativado");
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="font-heading">Notificações</CardTitle>
        <CardDescription>Configure alertas sonoros do sistema</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {enabled ? <Volume2 className="h-5 w-5 text-primary" /> : <VolumeX className="h-5 w-5 text-muted-foreground" />}
            <div>
              <Label className="text-sm font-medium">Som de notificação</Label>
              <p className="text-xs text-muted-foreground">Tocar som ao receber novas mensagens no Inbox</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={toggle} />
        </div>
      </CardContent>
    </Card>
  );
};

const OPENAI_MODELS = [
  { id: "gpt-4o", name: "GPT-4o", desc: "Multimodal: texto, imagem, áudio", icon: Sparkles },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", desc: "Rápido e econômico, multimodal", icon: MessageSquare },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", desc: "Texto e imagem, contexto 128k", icon: Brain },
  { id: "gpt-4", name: "GPT-4", desc: "Raciocínio avançado", icon: Brain },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", desc: "Rápido e acessível", icon: MessageSquare },
  { id: "o1", name: "o1", desc: "Raciocínio complexo e multi-etapa", icon: Brain },
  { id: "o1-mini", name: "o1 Mini", desc: "Raciocínio rápido", icon: Brain },
  { id: "o3-mini", name: "o3 Mini", desc: "Raciocínio otimizado", icon: Brain },
  { id: "whisper-1", name: "Whisper", desc: "Transcrição de áudio → texto", icon: Mic },
  { id: "tts-1", name: "TTS-1", desc: "Texto → áudio (voz natural)", icon: Volume2 },
  { id: "tts-1-hd", name: "TTS-1 HD", desc: "Texto → áudio (alta definição)", icon: Volume2 },
  { id: "dall-e-3", name: "DALL·E 3", desc: "Geração de imagens a partir de texto", icon: Image },
  { id: "dall-e-2", name: "DALL·E 2", desc: "Geração e edição de imagens", icon: Image },
  { id: "text-embedding-3-large", name: "Embedding 3 Large", desc: "Embeddings de alta dimensão", icon: Wrench },
  { id: "text-embedding-3-small", name: "Embedding 3 Small", desc: "Embeddings econômicos", icon: Wrench },
  { id: "gpt-4o-audio-preview", name: "GPT-4o Audio", desc: "Entrada/saída de áudio nativa", icon: Mic },
  { id: "gpt-4o-realtime-preview", name: "GPT-4o Realtime", desc: "Conversação em tempo real", icon: Mic },
];

const GEMINI_MODELS = [
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", desc: "Multimodal top: texto, imagem, áudio, vídeo", icon: Sparkles },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", desc: "Balanceado: custo × qualidade", icon: MessageSquare },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", desc: "Mais rápido e econômico", icon: MessageSquare },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", desc: "Multimodal rápido", icon: MessageSquare },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", desc: "Contexto de 2M tokens, multimodal", icon: Brain },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", desc: "Rápido, contexto 1M tokens", icon: MessageSquare },
  { id: "gemini-pro-vision", name: "Gemini Pro Vision", desc: "Análise de imagens e vídeos", icon: Image },
  { id: "text-embedding-004", name: "Text Embedding 004", desc: "Embeddings de texto", icon: Wrench },
  { id: "imagen-3", name: "Imagen 3", desc: "Geração de imagens de alta qualidade", icon: Image },
  { id: "veo-2", name: "Veo 2", desc: "Geração de vídeos", icon: Video },
  { id: "chirp-2", name: "Chirp 2 (STT)", desc: "Speech-to-Text avançado", icon: Mic },
  { id: "cloud-tts", name: "Cloud TTS", desc: "Text-to-Speech com vozes naturais", icon: Volume2 },
];

const LlmApiConfig = () => {
  const { user } = useAuth();
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [geminiSaved, setGeminiSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("settings")
        .select("key, value")
        .eq("user_id", user.id)
        .in("key", ["llm_openai", "llm_gemini"]);
      if (data) {
        for (const row of data) {
          const val = row.value as { apiKey?: string };
          if (row.key === "llm_openai" && val?.apiKey) {
            setOpenaiKey(val.apiKey);
            setOpenaiSaved(true);
          }
          if (row.key === "llm_gemini" && val?.apiKey) {
            setGeminiKey(val.apiKey);
            setGeminiSaved(true);
          }
        }
      }
    };
    load();
  }, [user]);

  const saveKey = async (provider: "openai" | "gemini") => {
    if (!user) return;
    setSaving(true);
    const key = provider === "openai" ? "llm_openai" : "llm_gemini";
    const apiKey = provider === "openai" ? openaiKey.trim() : geminiKey.trim();
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key, value: { apiKey } as any },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      if (provider === "openai") setOpenaiSaved(true);
      else setGeminiSaved(true);
      toast.success(`API Key ${provider === "openai" ? "OpenAI" : "Gemini"} salva com sucesso!`);
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (provider: "openai" | "gemini") => {
    if (!user) return;
    const key = provider === "openai" ? "llm_openai" : "llm_gemini";
    try {
      await supabase.from("settings").delete().eq("user_id", user.id).eq("key", key);
      if (provider === "openai") { setOpenaiKey(""); setOpenaiSaved(false); }
      else { setGeminiKey(""); setGeminiSaved(false); }
      toast.success("API Key removida.");
    } catch {
      toast.error("Erro ao remover.");
    }
  };

  const maskKey = (k: string) => k.length > 8 ? k.slice(0, 4) + "••••••••" + k.slice(-4) : "••••••••";

  const renderModels = (models: typeof OPENAI_MODELS, configured: boolean) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
      {models.map((m) => {
        const Icon = m.icon;
        return (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 rounded-lg border p-3 transition-colors ${
              configured ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"
            }`}
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${configured ? "text-primary" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">{m.name}</p>
              <p className="text-xs text-muted-foreground leading-tight">{m.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* OpenAI */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="font-heading">OpenAI</CardTitle>
              <CardDescription>GPT-4o, Whisper, DALL·E, TTS e mais</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showOpenai ? "text" : "password"}
                  placeholder="sk-..."
                  value={openaiKey}
                  onChange={(e) => { setOpenaiKey(e.target.value); setOpenaiSaved(false); }}
                />
                <button
                  type="button"
                  onClick={() => setShowOpenai(!showOpenai)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showOpenai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={() => saveKey("openai")} disabled={saving || !openaiKey.trim()} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </Button>
              {openaiSaved && (
                <Button variant="destructive" size="sm" onClick={() => removeKey("openai")}>
                  Remover
                </Button>
              )}
            </div>
            {openaiSaved && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configurada: {maskKey(openaiKey)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Obtenha em{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="underline text-primary">
                platform.openai.com
              </a>
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Modelos disponíveis ({OPENAI_MODELS.length})</p>
            {renderModels(OPENAI_MODELS, openaiSaved)}
          </div>
        </CardContent>
      </Card>

      {/* Gemini */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="font-heading">Google Gemini</CardTitle>
              <CardDescription>Gemini 2.5, Imagen, Veo, STT/TTS e mais</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showGemini ? "text" : "password"}
                  placeholder="AIza..."
                  value={geminiKey}
                  onChange={(e) => { setGeminiKey(e.target.value); setGeminiSaved(false); }}
                />
                <button
                  type="button"
                  onClick={() => setShowGemini(!showGemini)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={() => saveKey("gemini")} disabled={saving || !geminiKey.trim()} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </Button>
              {geminiSaved && (
                <Button variant="destructive" size="sm" onClick={() => removeKey("gemini")}>
                  Remover
                </Button>
              )}
            </div>
            {geminiSaved && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configurada: {maskKey(geminiKey)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Obtenha em{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="underline text-primary">
                aistudio.google.com
              </a>
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Modelos disponíveis ({GEMINI_MODELS.length})</p>
            {renderModels(GEMINI_MODELS, geminiSaved)}
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Capacidades disponíveis com as APIs
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["Chat / Conversação", "Transcrição de áudio", "Leitura de PDF", "Análise de imagens", "Geração de imagens", "Text-to-Speech", "Geração de vídeo", "Embeddings", "Raciocínio avançado", "Conversação em tempo real"].map((cap) => (
                <span key={cap} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary font-medium">
                  {cap}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              As chaves são armazenadas de forma segura e utilizadas apenas para chamadas de API nos recursos do sistema.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
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
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "checking" | "connected" | "disconnected" | "error">("idle");
  const [connectionInfo, setConnectionInfo] = useState<{ phone?: string; name?: string; status?: string; battery?: number } | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Auto-check connection status
  const checkConnectionStatus = async () => {
    setConnectionStatus("checking");
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "test" },
      });
      if (error) throw error;
      if (data.connected) {
        setConnectionStatus("connected");
        setConnectionInfo({
          phone: data.phone || data.instance?.user?.id?.replace("@s.whatsapp.net", "") || undefined,
          name: data.name || data.instance?.user?.name || data.pushname || undefined,
          status: data.status || data.state || "connected",
          battery: data.battery ?? data.instance?.battery ?? undefined,
        });
      } else {
        setConnectionStatus("disconnected");
        setConnectionInfo(null);
      }
    } catch {
      setConnectionStatus("error");
      setConnectionInfo(null);
    }
    setLastChecked(new Date());
  };

  // Load saved settings & auto-check
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

        // Auto-check if config has the minimum required fields
        if (config.baseUrl && config.instanceToken) {
          checkConnectionStatus();
        }
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
    await saveConfig();
    setTesting(true);
    await checkConnectionStatus();
    setTesting(false);
    if (connectionStatus === "connected") {
      toast.success("Conexão estabelecida com sucesso!");
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
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="font-heading text-xl md:text-2xl font-bold">Configurações</h1>
        <p className="text-xs md:text-sm text-muted-foreground">Gerencie as configurações do sistema</p>
      </div>

      <Tabs defaultValue="connection" className="space-y-4">
        <TabsList className="w-full flex overflow-x-auto">
          <TabsTrigger value="connection" className="text-xs md:text-sm">Conexão</TabsTrigger>
          <TabsTrigger value="apillm" className="text-xs md:text-sm">API LLM</TabsTrigger>
          <TabsTrigger value="company" className="text-xs md:text-sm">Empresa</TabsTrigger>
          <TabsTrigger value="users" className="text-xs md:text-sm">Usuários</TabsTrigger>
          <TabsTrigger value="webhooks" className="text-xs md:text-sm">Webhooks</TabsTrigger>
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

          {/* Connection Status — prominent card */}
          <Card className={`border-2 ${
            connectionStatus === "connected" ? "border-emerald-500/30" :
            connectionStatus === "disconnected" || connectionStatus === "error" ? "border-destructive/30" :
            "border-border"
          }`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-heading">Status da Conexão WhatsApp</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => checkConnectionStatus()}
                  disabled={connectionStatus === "checking"}
                  className="h-8 gap-1.5 text-xs"
                >
                  {connectionStatus === "checking" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Main status indicator */}
              {connectionStatus === "checking" ? (
                <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/50 p-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Verificando conexão...</p>
                    <p className="text-xs text-muted-foreground">Consultando o status da instância</p>
                  </div>
                </div>
              ) : connectionStatus === "connected" ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                      <Smartphone className="h-6 w-6 text-emerald-500" />
                      <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-emerald-600 dark:text-emerald-400">Conectado</p>
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          Online
                        </span>
                      </div>
                      {(connectionInfo?.name || connectionInfo?.phone) && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {connectionInfo.name && (
                            <p className="text-sm text-foreground font-medium">{connectionInfo.name}</p>
                          )}
                          {connectionInfo.phone && (
                            <p className="text-sm text-muted-foreground">📱 {connectionInfo.phone}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {lastChecked && (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-emerald-500/10 pt-3">
                      <Clock className="h-3 w-3" />
                      Última verificação: {lastChecked.toLocaleTimeString("pt-BR")}
                    </div>
                  )}
                </div>
              ) : connectionStatus === "disconnected" || connectionStatus === "error" ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5">
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                      <WifiOff className="h-6 w-6 text-destructive" />
                      <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-destructive" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-destructive">Desconectado</p>
                      <p className="text-sm text-muted-foreground">
                        O WhatsApp não está conectado. Gere um QR Code para conectar.
                      </p>
                    </div>
                  </div>
                  {lastChecked && (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-destructive/10 pt-3">
                      <Clock className="h-3 w-3" />
                      Última verificação: {lastChecked.toLocaleTimeString("pt-BR")}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-muted/30 p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <WifiOff className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Sem configuração</p>
                      <p className="text-xs text-muted-foreground">
                        Configure as credenciais acima para verificar o status.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
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

          <NotificationSoundToggle />
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

        <TabsContent value="apillm">
          <LlmApiConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
