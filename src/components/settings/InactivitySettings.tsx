import { useState, useEffect } from "react";
import { TimerOff, Save, Loader2, CheckCircle2 } from "lucide-react";
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
}

const DEFAULT_CONFIG: InactivityConfig = {
  enabled: false,
  hours: 24,
  closeMessage:
    "Seu atendimento foi encerrado por inatividade. Caso precise de ajuda novamente, envie uma nova mensagem. 😊",
  resetAutomation: true,
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
        setConfig({ ...DEFAULT_CONFIG, ...(data.value as any) });
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
              <span className="text-sm text-muted-foreground">
                horas sem resposta do cliente
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Se o cliente não responder dentro desse período, a conversa será automaticamente encerrada.
            </p>
          </div>

          {/* Reset automation toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Resetar fluxo de automação</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quando o cliente enviar uma nova mensagem após o encerramento, o fluxo de automação
                reiniciará do início, evitando misturar históricos.
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
              placeholder="Mensagem enviada ao cliente quando o atendimento for encerrado por inatividade..."
              className="min-h-[80px] text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Deixe em branco para encerrar silenciosamente. Use{" "}
              <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para o nome do contato.
            </p>
          </div>

          {/* Preset options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">Atalhos</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "6 horas", value: 6 },
                { label: "12 horas", value: 12 },
                { label: "24 horas", value: 24 },
                { label: "48 horas", value: 48 },
              ].map((preset) => (
                <Button
                  key={preset.value}
                  variant={config.hours === preset.value ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setConfig((p) => ({ ...p, hours: preset.value }))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar Configuração
            </Button>
            {loaded && config.enabled && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Auto-encerramento ativo ({config.hours}h)
              </div>
            )}
          </div>

          {/* Info */}
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
            <p className="text-sm font-medium">Como funciona:</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>
                Quando o cliente não interage por <strong>{config.hours} hora(s)</strong>, a conversa
                é marcada como <span className="text-destructive font-medium">Resolvida</span>.
              </li>
              <li>
                Ao receber uma nova mensagem, o sistema cria um{" "}
                <span className="text-primary font-medium">novo atendimento</span>, sem misturar com
                o histórico anterior.
              </li>
              <li>
                O fluxo de automação (Atendimento Multimodal, SAC, etc.) reinicia do zero para o novo
                atendimento.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InactivitySettings;
