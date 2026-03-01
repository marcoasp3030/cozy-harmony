import { useState, useEffect, useCallback } from "react";
import { Wifi, WifiOff, CheckCircle2, Loader2, QrCode, Unplug, Save, Plus, Link2, ExternalLink, Copy, Check, Volume2, VolumeX, Brain, Eye, EyeOff, Sparkles, FileText, Image, Mic, Video, MessageSquare, Wrench } from "lucide-react";
import InstanceManager from "@/components/settings/InstanceManager";
import ElevenLabsSettings from "@/components/settings/ElevenLabsSettings";
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

const WhatsAppApiConfig = () => {
  const { user } = useAuth();
  const [baseUrl, setBaseUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [showAdminToken, setShowAdminToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Try loading new global config
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "uazapi_global")
        .single();

      if (data?.value) {
        const v = data.value as any;
        setBaseUrl(v.baseUrl || "");
        setAdminToken(v.adminToken || "");
        setLoaded(true);
        return;
      }

      // Migrate from legacy uazapi_config
      const { data: legacy } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "uazapi_config")
        .single();

      if (legacy?.value) {
        const v = legacy.value as any;
        const migratedBaseUrl = v.baseUrl || "";
        const migratedAdminToken = v.adminToken || "";
        if (migratedBaseUrl) {
          setBaseUrl(migratedBaseUrl);
          setAdminToken(migratedAdminToken);
          // Save as new global config
          await supabase
            .from("settings")
            .upsert(
              { user_id: user.id, key: "uazapi_global", value: { baseUrl: migratedBaseUrl, adminToken: migratedAdminToken } as any },
              { onConflict: "user_id,key" }
            );
          // Also migrate instance if legacy had instanceToken
          const instanceToken = v.instanceToken || "";
          const instanceName = v.instanceName || "";
          if (instanceToken) {
            const { data: existing } = await supabase
              .from("whatsapp_instances")
              .select("id")
              .eq("user_id", user.id)
              .limit(1);
            if (!existing || existing.length === 0) {
              await supabase.from("whatsapp_instances").insert({
                user_id: user.id,
                name: instanceName || "WhatsApp (migrado)",
                base_url: migratedBaseUrl,
                admin_token: migratedAdminToken,
                instance_token: instanceToken,
                instance_name: instanceName,
                is_default: true,
              } as any);
            }
          }
          toast.success("Configuração legada migrada automaticamente!");
        }
      }
      setLoaded(true);
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!baseUrl.trim()) {
      toast.error("URL da UazAPI é obrigatória.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "uazapi_global", value: { baseUrl: baseUrl.trim(), adminToken: adminToken.trim() } as any },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      toast.success("Configuração da API WhatsApp salva com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const maskKey = (k: string) => k.length > 8 ? k.slice(0, 4) + "••••••••" + k.slice(-4) : "••••••••";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">API WhatsApp (UazAPI)</CardTitle>
        <CardDescription>
          Configure a URL e o Admin Token da sua UazAPI. Essas informações são compartilhadas entre todas as instâncias.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>URL da UazAPI *</Label>
          <Input
            placeholder="https://seudominio.uazapi.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Endereço base da sua instalação UazAPI
          </p>
        </div>

        <div className="space-y-2">
          <Label>Admin Token *</Label>
          <div className="relative">
            <Input
              type={showAdminToken ? "text" : "password"}
              placeholder="Token de administrador da UazAPI"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowAdminToken(!showAdminToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showAdminToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Necessário para criar e gerenciar instâncias automaticamente
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving || !baseUrl.trim()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar Configuração
        </Button>

        {loaded && baseUrl && adminToken && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Configurado — Admin Token: {maskKey(adminToken)}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const SettingsPage = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="font-heading text-xl md:text-2xl font-bold">Configurações</h1>
        <p className="text-xs md:text-sm text-muted-foreground">Gerencie as configurações do sistema</p>
      </div>

      <Tabs defaultValue="apiwhatsapp" className="space-y-4">
        <TabsList className="w-full flex overflow-x-auto">
          <TabsTrigger value="apiwhatsapp" className="text-xs md:text-sm">API WhatsApp</TabsTrigger>
          <TabsTrigger value="connection" className="text-xs md:text-sm">Instâncias</TabsTrigger>
          <TabsTrigger value="apillm" className="text-xs md:text-sm">API LLM</TabsTrigger>
          <TabsTrigger value="elevenlabs" className="text-xs md:text-sm">ElevenLabs</TabsTrigger>
          <TabsTrigger value="company" className="text-xs md:text-sm">Empresa</TabsTrigger>
          <TabsTrigger value="users" className="text-xs md:text-sm">Usuários</TabsTrigger>
          <TabsTrigger value="webhooks" className="text-xs md:text-sm">Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="apiwhatsapp" className="space-y-4">
          <WhatsAppApiConfig />
        </TabsContent>

        <TabsContent value="connection" className="space-y-4">
          <InstanceManager />
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

        <TabsContent value="elevenlabs">
          <ElevenLabsSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
