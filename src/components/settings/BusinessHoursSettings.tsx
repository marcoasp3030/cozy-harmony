import { useState, useEffect } from "react";
import { Clock, Save, Loader2, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Shift {
  start: string;
  end: string;
}

interface DaySchedule {
  enabled: boolean;
  shifts: Shift[];
}

export interface BusinessHoursConfig {
  enabled: boolean;
  timezone: string;
  days: Record<string, DaySchedule>;
  outOfHoursMessage: string;
}

const DAYS = [
  { key: "1", label: "Segunda-feira", short: "Seg" },
  { key: "2", label: "Terça-feira", short: "Ter" },
  { key: "3", label: "Quarta-feira", short: "Qua" },
  { key: "4", label: "Quinta-feira", short: "Qui" },
  { key: "5", label: "Sexta-feira", short: "Sex" },
  { key: "6", label: "Sábado", short: "Sáb" },
  { key: "7", label: "Domingo", short: "Dom" },
];

const DEFAULT_SHIFT: Shift = { start: "08:00", end: "18:00" };

const DEFAULT_CONFIG: BusinessHoursConfig = {
  enabled: false,
  timezone: "America/Sao_Paulo",
  days: {
    "1": { enabled: true, shifts: [{ start: "08:00", end: "18:00" }] },
    "2": { enabled: true, shifts: [{ start: "08:00", end: "18:00" }] },
    "3": { enabled: true, shifts: [{ start: "08:00", end: "18:00" }] },
    "4": { enabled: true, shifts: [{ start: "08:00", end: "18:00" }] },
    "5": { enabled: true, shifts: [{ start: "08:00", end: "18:00" }] },
    "6": { enabled: false, shifts: [{ start: "08:00", end: "12:00" }] },
    "7": { enabled: false, shifts: [] },
  },
  outOfHoursMessage:
    "Olá! 😊 No momento estamos fora do horário de atendimento. Retornaremos assim que possível. Obrigado!",
};

/** Migrate old single-shift format to multi-shift */
const migrateConfig = (raw: any): BusinessHoursConfig => {
  const base = { ...DEFAULT_CONFIG, ...raw };
  if (base.days) {
    const migrated: Record<string, DaySchedule> = {};
    for (const [k, v] of Object.entries(base.days)) {
      const day = v as any;
      if (day.shifts && Array.isArray(day.shifts)) {
        migrated[k] = day;
      } else {
        // Old format: { enabled, start, end }
        migrated[k] = {
          enabled: day.enabled ?? false,
          shifts: day.start || day.end ? [{ start: day.start || "08:00", end: day.end || "18:00" }] : [{ ...DEFAULT_SHIFT }],
        };
      }
    }
    base.days = migrated;
  }
  return base;
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
        setConfig(migrateConfig(data.value));
      }
      setLoaded(true);
    };
    load();
  }, [user]);

  const updateDayEnabled = (dayKey: string, enabled: boolean) => {
    setConfig((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [dayKey]: { ...prev.days[dayKey], enabled },
      },
    }));
  };

  const updateShift = (dayKey: string, shiftIdx: number, field: keyof Shift, value: string) => {
    setConfig((prev) => {
      const day = prev.days[dayKey];
      const newShifts = [...day.shifts];
      newShifts[shiftIdx] = { ...newShifts[shiftIdx], [field]: value };
      return {
        ...prev,
        days: { ...prev.days, [dayKey]: { ...day, shifts: newShifts } },
      };
    });
  };

  const addShift = (dayKey: string) => {
    setConfig((prev) => {
      const day = prev.days[dayKey];
      const lastShift = day.shifts[day.shifts.length - 1];
      const newStart = lastShift ? lastShift.end : "14:00";
      return {
        ...prev,
        days: {
          ...prev.days,
          [dayKey]: { ...day, shifts: [...day.shifts, { start: newStart, end: "18:00" }] },
        },
      };
    });
  };

  const removeShift = (dayKey: string, shiftIdx: number) => {
    setConfig((prev) => {
      const day = prev.days[dayKey];
      return {
        ...prev,
        days: {
          ...prev.days,
          [dayKey]: { ...day, shifts: day.shifts.filter((_, i) => i !== shiftIdx) },
        },
      };
    });
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
          { ...v, shifts: ref.shifts.map((s) => ({ ...s })) },
        ])
      ),
    }));
    toast.info("Turnos da segunda aplicados a todos os dias.");
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
                  Defina os horários de funcionamento com múltiplos turnos por dia
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
              <Label className="text-sm font-medium">Dias e Turnos</Label>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={applyToAll}>
                Aplicar Seg. a todos
              </Button>
            </div>
            <div className="space-y-2">
              {DAYS.map((day) => {
                const schedule = config.days[day.key] || { enabled: false, shifts: [] };
                return (
                  <div
                    key={day.key}
                    className={`rounded-lg border p-3 transition-colors ${
                      schedule.enabled ? "bg-card border-border" : "bg-muted/30 border-border/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(v) => updateDayEnabled(day.key, v)}
                      />
                      <span className={`text-sm font-medium w-28 shrink-0 ${!schedule.enabled ? "text-muted-foreground" : ""}`}>
                        {day.label}
                      </span>
                      {!schedule.enabled && (
                        <span className="text-xs text-muted-foreground italic">Fechado</span>
                      )}
                    </div>

                    {schedule.enabled && (
                      <div className="mt-2 ml-[52px] space-y-1.5">
                        {schedule.shifts.map((shift, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-14 shrink-0">
                              Turno {idx + 1}
                            </span>
                            <Input
                              type="time"
                              value={shift.start}
                              onChange={(e) => updateShift(day.key, idx, "start", e.target.value)}
                              className="h-7 text-xs w-24"
                            />
                            <span className="text-xs text-muted-foreground">até</span>
                            <Input
                              type="time"
                              value={shift.end}
                              onChange={(e) => updateShift(day.key, idx, "end", e.target.value)}
                              className="h-7 text-xs w-24"
                            />
                            {schedule.shifts.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeShift(day.key, idx)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] gap-1 text-primary ml-14"
                          onClick={() => addShift(day.key)}
                        >
                          <Plus className="h-3 w-3" />
                          Adicionar turno
                        </Button>
                      </div>
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
              direcionando o fluxo pelo caminho <span className="text-success font-medium">Sim</span> (dentro) ou{" "}
              <span className="text-destructive font-medium">Não</span> (fora).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessHoursSettings;
