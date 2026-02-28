import { useState, useEffect } from "react";
import { Brain, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface SmartFunnelConfig {
  enabled: boolean;
  provider: "openai" | "gemini";
  model: string;
  min_confidence: number;
}

const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (rápido, econômico)" },
  { value: "gpt-4o", label: "GPT-4o (mais preciso)" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

const GEMINI_MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (rápido)" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (preciso)" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

const DEFAULT_CONFIG: SmartFunnelConfig = {
  enabled: true,
  provider: "openai",
  model: "gpt-4o-mini",
  min_confidence: 0.7,
};

const SmartFunnelSettings = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<SmartFunnelConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "smart_funnel")
      .single()
      .then(({ data }) => {
        if (data?.value) setConfig({ ...DEFAULT_CONFIG, ...(data.value as any) });
        setLoading(false);
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("settings")
        .select("id")
        .eq("user_id", user.id)
        .eq("key", "smart_funnel")
        .single();

      if (existing) {
        await supabase.from("settings").update({ value: config as any }).eq("id", existing.id);
      } else {
        await supabase.from("settings").insert({ user_id: user.id, key: "smart_funnel", value: config as any });
      }
      toast.success("Configurações salvas!");
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const models = config.provider === "openai" ? OPENAI_MODELS : GEMINI_MODELS;

  if (loading) return <Loader2 className="h-4 w-4 animate-spin mx-auto my-4" />;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="h-6 w-6 text-primary/70" />
          <div>
            <p className="text-sm font-medium">Classificação por IA</p>
            <p className="text-xs text-muted-foreground">
              Analisa mensagens e sugere movimentações no funil
            </p>
          </div>
          <div className="ml-auto">
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </div>
        </div>

        {config.enabled && (
          <div className="space-y-4 pt-2 border-t border-border">
            {/* Provider */}
            <div className="space-y-1.5">
              <Label className="text-xs">Provedor</Label>
              <Select
                value={config.provider}
                onValueChange={(v) => {
                  const provider = v as "openai" | "gemini";
                  const defaultModel = provider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash";
                  setConfig({ ...config, provider, model: defaultModel });
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">OpenAI</span>
                      <span className="text-xs text-muted-foreground">GPT-4o</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="gemini">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Google Gemini</span>
                      <span className="text-xs text-muted-foreground">Flash / Pro</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label className="text-xs">Modelo</Label>
              <Select
                value={config.model}
                onValueChange={(model) => setConfig({ ...config, model })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Confidence */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Confiança mínima</Label>
                <span className="text-xs font-mono text-muted-foreground">{Math.round(config.min_confidence * 100)}%</span>
              </div>
              <Slider
                min={0.3}
                max={1.0}
                step={0.05}
                value={[config.min_confidence]}
                onValueChange={([v]) => setConfig({ ...config, min_confidence: v })}
              />
              <p className="text-[10px] text-muted-foreground">
                Sugestões abaixo desse nível de confiança serão descartadas
              </p>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              ⚠️ Certifique-se de que a API Key do provedor selecionado está configurada em <strong>Configurações → API LLM</strong>.
            </div>
          </div>
        )}
      </div>

      <Button onClick={save} disabled={saving} className="w-full">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Salvar Configurações
      </Button>
    </div>
  );
};

export default SmartFunnelSettings;
