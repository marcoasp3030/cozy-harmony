import { useState, useEffect } from "react";
import { TimerOff, Save, Loader2, CheckCircle2, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface InactivityConfig {
  enabled: boolean;
  hours: number;
  closeMessage: string;
  resetAutomation: boolean;
  survey: {
    enabled: boolean;
    question: string;
    options: { label: string; value: string }[];
    thankYouMessage: string;
  };
}

const DEFAULT_CONFIG: InactivityConfig = {
  enabled: false,
  hours: 24,
  closeMessage:
    "Seu atendimento foi encerrado por inatividade. Caso precise de ajuda novamente, envie uma nova mensagem. 😊",
  resetAutomation: true,
  survey: {
    enabled: true,
    question:
      "Antes de encerrar, como você avalia o nosso atendimento?",
    options: [
      { label: "⭐ Ótimo", value: "otimo" },
      { label: "👍 Bom", value: "bom" },
      { label: "👎 Ruim", value: "ruim" },
    ],
    thankYouMessage: "Obrigado pela sua avaliação, {{nome}}! Sua opinião é muito importante para nós. 💚",
  },
};

const InactivitySettings = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<InactivityConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "inactivity_auto_close")
        .single();
      if (data?.value) {
        const raw = data.value as any;
        setConfig({
          ...DEFAULT_CONFIG,
          ...raw,
          survey: { ...DEFAULT_CONFIG.survey, ...(raw.survey || {}) },
        });
      }
      setLoaded(true);
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (config.hours < 1) {
      toast.error("O tempo mínimo é 1 hora.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "inactivity_auto_close", value: config as any },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      toast.success("Configuração de auto-encerramento salva!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const updateSurvey = (field: string, value: any) => {
    setConfig((p) => ({ ...p, survey: { ...p.survey, [field]: value } }));
  };

  const updateOption = (idx: number, field: "label" | "value", val: string) => {
    setConfig((p) => {
      const opts = [...p.survey.options];
      opts[idx] = { ...opts[idx], [field]: val };
      return { ...p, survey: { ...p.survey, options: opts } };
    });
  };

  const addOption = () => {
    if (config.survey.options.length >= 3) {
      toast.error("WhatsApp permite no máximo 3 botões.");
      return;
    }
    setConfig((p) => ({
      ...p,
      survey: { ...p.survey, options: [...p.survey.options, { label: "Novo", value: "novo" }] },
    }));
  };

  const removeOption = (idx: number) => {
    if (config.survey.options.length <= 2) {
      toast.error("Mínimo de 2 opções.");
      return;
    }
    setConfig((p) => ({
      ...p,
      survey: { ...p.survey, options: p.survey.options.filter((_, i) => i !== idx) },
    }));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TimerOff className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="font-heading">Auto-encerramento por Inatividade</CardTitle>
                <CardDescription>
                  Encerre atendimentos automaticamente após um período sem interação do cliente
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => setConfig((p) => ({ ...p, enabled: v }))}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Hours input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Tempo de inatividade (horas)</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={720}
                value={config.hours}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, hours: Math.max(1, parseInt(e.target.value) || 1) }))
                }
                className="w-24 h-9"
              />
              <span className="text-sm text-muted-foreground">horas sem resposta do cliente</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Se o cliente não responder dentro desse período, a conversa será automaticamente encerrada.
            </p>
          </div>

          {/* Preset options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">Atalhos</Label>
            <div className="flex flex-wrap gap-2">
              {[6, 12, 24, 48].map((v) => (
                <Button
                  key={v}
                  variant={config.hours === v ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setConfig((p) => ({ ...p, hours: v }))}
                >
                  {v} horas
                </Button>
              ))}
            </div>
          </div>

          {/* Reset automation toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Resetar fluxo de automação</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ao receber nova mensagem após encerramento, o fluxo de automação reinicia do início.
              </p>
            </div>
            <Switch
              checked={config.resetAutomation}
              onCheckedChange={(v) => setConfig((p) => ({ ...p, resetAutomation: v }))}
            />
          </div>

          {/* Close message */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mensagem de encerramento (opcional)</Label>
            <Textarea
              value={config.closeMessage}
              onChange={(e) => setConfig((p) => ({ ...p, closeMessage: e.target.value }))}
              placeholder="Mensagem enviada ao encerrar por inatividade..."
              className="min-h-[70px] text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Deixe em branco para encerrar silenciosamente. Use{" "}
              <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para o nome do contato.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── SATISFACTION SURVEY CARD ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-warning" />
              <div>
                <CardTitle className="font-heading text-lg">Pesquisa de Satisfação</CardTitle>
                <CardDescription>
                  Envie uma pesquisa com botões interativos antes de encerrar o atendimento
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={config.survey.enabled}
              onCheckedChange={(v) => updateSurvey("enabled", v)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Survey question */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Pergunta da pesquisa</Label>
            <Textarea
              value={config.survey.question}
              onChange={(e) => updateSurvey("question", e.target.value)}
              placeholder="Como você avalia o nosso atendimento?"
              className="min-h-[60px] text-sm"
            />
          </div>

          {/* Button options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Opções de resposta (botões)</Label>
            <div className="space-y-2">
              {config.survey.options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6 shrink-0">{idx + 1}.</span>
                  <Input
                    value={opt.label}
                    onChange={(e) => updateOption(idx, "label", e.target.value)}
                    placeholder="Texto do botão"
                    className="h-8 text-sm flex-1"
                    maxLength={20}
                  />
                  <Input
                    value={opt.value}
                    onChange={(e) => updateOption(idx, "value", e.target.value)}
                    placeholder="ID"
                    className="h-8 text-sm w-24"
                    maxLength={20}
                  />
                  {config.survey.options.length > 2 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeOption(idx)}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {config.survey.options.length < 3 && (
              <Button variant="ghost" size="sm" className="text-xs h-7 text-primary" onClick={addOption}>
                + Adicionar opção
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Máximo de 3 botões (limite do WhatsApp). O texto deve ter até 20 caracteres.
            </p>
          </div>

          {/* Thank you message */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mensagem de agradecimento</Label>
            <Textarea
              value={config.survey.thankYouMessage}
              onChange={(e) => updateSurvey("thankYouMessage", e.target.value)}
              placeholder="Obrigado pela sua avaliação!"
              className="min-h-[60px] text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Enviada após o cliente responder. Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code>{" "}
              e <code className="bg-muted px-1 rounded">{"{{resposta}}"}</code>.
            </p>
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <p className="text-sm font-medium">Pré-visualização no WhatsApp:</p>
            <div className="rounded-lg bg-background border p-3 max-w-xs space-y-2">
              <p className="text-sm">{config.survey.question || "Como você avalia o atendimento?"}</p>
              <div className="flex flex-col gap-1.5">
                {config.survey.options.map((opt, idx) => (
                  <div
                    key={idx}
                    className="text-center text-xs font-medium text-primary border border-primary/30 rounded-md py-1.5 px-3"
                  >
                    {opt.label || `Opção ${idx + 1}`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save & Info */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar Configuração
        </Button>
        {loaded && config.enabled && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Auto-encerramento ativo ({config.hours}h)
            {config.survey.enabled && " + Pesquisa"}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
        <p className="text-sm font-medium">Como funciona:</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li>
            Após <strong>{config.hours}h</strong> sem interação, o sistema envia a
            {config.survey.enabled ? " pesquisa de satisfação com botões" : " mensagem de encerramento"}.
          </li>
          <li>A conversa é marcada como <span className="text-destructive font-medium">Resolvida</span>.</li>
          <li>
            Nova mensagem do cliente inicia um <span className="text-primary font-medium">novo atendimento</span> do zero.
          </li>
          {config.survey.enabled && (
            <li>
              A resposta da pesquisa é salva como tag no contato para análise posterior nos relatórios.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default InactivitySettings;
