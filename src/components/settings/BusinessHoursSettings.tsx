import { useState, useEffect } from "react";
import { Clock, Save, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
}

export interface BusinessHoursConfig {
  enabled: boolean;
  timezone: string;
  days: Record<string, DaySchedule>;
  outOfHoursMessage: string;
}

const DAYS = [
  { key: "1", label: "Segunda-feira" },
  { key: "2", label: "Terça-feira" },
  { key: "3", label: "Quarta-feira" },
  { key: "4", label: "Quinta-feira" },
  { key: "5", label: "Sexta-feira" },
  { key: "6", label: "Sábado" },
  { key: "7", label: "Domingo" },
];

const DEFAULT_CONFIG: BusinessHoursConfig = {
  enabled: false,
  timezone: "America/Sao_Paulo",
  days: {
    "1": { enabled: true, start: "08:00", end: "18:00" },
    "2": { enabled: true, start: "08:00", end: "18:00" },
    "3": { enabled: true, start: "08:00", end: "18:00" },
    "4": { enabled: true, start: "08:00", end: "18:00" },
    "5": { enabled: true, start: "08:00", end: "18:00" },
    "6": { enabled: false, start: "08:00", end: "12:00" },
    "7": { enabled: false, start: "", end: "" },
  },
  outOfHoursMessage:
    "Olá! 😊 No momento estamos fora do horário de atendimento. Retornaremos assim que possível. Obrigado!",
};

const BusinessHoursSettings = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<BusinessHoursConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "business_hours")
        .single();
      if (data?.value) {
        setConfig({ ...DEFAULT_CONFIG, ...(data.value as any) });
      }
      setLoaded(true);
    };
    load();
  }, [user]);

  const updateDay = (dayKey: string, field: keyof DaySchedule, value: any) => {
    setConfig((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [dayKey]: { ...prev.days[dayKey], [field]: value },
      },
    }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "business_hours", value: config as any },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      toast.success("Horário de expediente salvo com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const applyToAll = () => {
    const ref = config.days["1"];
    setConfig((prev) => ({
      ...prev,
      days: Object.fromEntries(
        Object.entries(prev.days).map(([k, v]) => [
          k,
          { ...v, start: ref.start, end: ref.end },
        ])
      ),
    }));
    toast.info("Horário da segunda aplicado a todos os dias.");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="font-heading">Horário de Expediente</CardTitle>
                <CardDescription>
                  Defina os horários de funcionamento para responder automaticamente fora do expediente
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
          {/* Schedule per day */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Dias e Horários</Label>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={applyToAll}>
                Aplicar Seg. a todos
              </Button>
            </div>
            <div className="space-y-2">
              {DAYS.map((day) => {
                const schedule = config.days[day.key] || { enabled: false, start: "08:00", end: "18:00" };
                return (
                  <div
                    key={day.key}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                      schedule.enabled ? "bg-card border-border" : "bg-muted/30 border-border/50"
                    }`}
                  >
                    <Switch
                      checked={schedule.enabled}
                      onCheckedChange={(v) => updateDay(day.key, "enabled", v)}
                    />
                    <span className={`text-sm font-medium w-28 ${!schedule.enabled && "text-muted-foreground"}`}>
                      {day.label}
                    </span>
                    {schedule.enabled ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="time"
                          value={schedule.start}
                          onChange={(e) => updateDay(day.key, "start", e.target.value)}
                          className="h-8 text-xs w-28"
                        />
                        <span className="text-xs text-muted-foreground">até</span>
                        <Input
                          type="time"
                          value={schedule.end}
                          onChange={(e) => updateDay(day.key, "end", e.target.value)}
                          className="h-8 text-xs w-28"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Fechado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Out of hours message */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mensagem fora do expediente</Label>
            <Textarea
              value={config.outOfHoursMessage}
              onChange={(e) => setConfig((p) => ({ ...p, outOfHoursMessage: e.target.value }))}
              placeholder="Mensagem enviada quando o cliente entrar em contato fora do horário..."
              className="min-h-[100px] text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para inserir o nome do contato.
            </p>
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Fuso Horário</Label>
            <Input
              value={config.timezone}
              onChange={(e) => setConfig((p) => ({ ...p, timezone: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Horários
            </Button>
            {loaded && config.enabled && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Expediente ativo
              </div>
            )}
          </div>

          {/* Usage hint */}
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
            <p className="text-sm font-medium">Como usar nas automações:</p>
            <p className="text-xs text-muted-foreground">
              Adicione o nó <strong>"Verificar Expediente"</strong> (categoria Condições) no seu fluxo de automação. 
              Ele usará os horários configurados aqui para decidir se a mensagem chegou dentro ou fora do expediente, 
              direcionando o fluxo pelo caminho <span className="text-green-500 font-medium">Sim</span> (dentro) ou{" "}
              <span className="text-red-500 font-medium">Não</span> (fora).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessHoursSettings;
