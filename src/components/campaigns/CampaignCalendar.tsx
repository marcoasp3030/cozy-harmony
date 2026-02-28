import { useMemo, useState } from "react";
import { format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, GripVertical, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { type Campaign, statusConfig } from "./CampaignCard";

interface CampaignCalendarProps {
  campaigns: Campaign[];
  onCampaignClick?: (campaign: Campaign) => void;
  onCreateAtDate?: (date: Date) => void;
  onReload?: () => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_COLORS: Record<string, string> = {
  running: "bg-emerald-500",
  completed: "bg-primary",
  paused: "bg-amber-500",
  draft: "bg-muted-foreground/40",
  scheduled: "bg-sky-500",
  cancelled: "bg-destructive",
};

export default function CampaignCalendar({ campaigns, onCampaignClick, onCreateAtDate, onReload }: CampaignCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [rescheduleTarget, setRescheduleTarget] = useState<Campaign | null>(null);
  const [newDate, setNewDate] = useState<Date | undefined>();
  const [newTime, setNewTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  const scheduledCampaigns = useMemo(
    () => campaigns.filter((c) => c.scheduled_at || c.settings?.recurrence),
    [campaigns],
  );

  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const startDayOfWeek = getDay(days[0]);

  const getCampaignsForDay = (day: Date) => {
    return scheduledCampaigns.filter((c) => {
      if (c.scheduled_at && isSameDay(new Date(c.scheduled_at), day)) return true;
      const rec = c.settings?.recurrence;
      if (!rec || !c.scheduled_at) return false;
      const baseDate = new Date(c.scheduled_at);
      if (day < baseDate) return false;
      if (rec.type === "daily") return true;
      if (rec.type === "weekly") return getDay(day) === getDay(baseDate);
      if (rec.type === "monthly") return day.getDate() === baseDate.getDate();
      return false;
    });
  };

  const today = new Date();

  const handleReschedule = async () => {
    if (!rescheduleTarget || !newDate) return;
    setSaving(true);
    try {
      const [h, m] = newTime.split(":").map(Number);
      const finalDate = new Date(newDate);
      finalDate.setHours(h, m, 0, 0);

      const { error } = await supabase
        .from("campaigns")
        .update({ scheduled_at: finalDate.toISOString(), status: "scheduled" } as any)
        .eq("id", rescheduleTarget.id);
      if (error) throw error;
      toast.success("Campanha reagendada!");
      setRescheduleTarget(null);
      onReload?.();
    } catch (err: any) {
      toast.error("Erro ao reagendar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const openReschedule = (campaign: Campaign, e: React.MouseEvent) => {
    e.stopPropagation();
    if (campaign.status !== "draft" && campaign.status !== "scheduled") return;
    const existing = campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date();
    setNewDate(existing);
    setNewTime(format(existing, "HH:mm"));
    setRescheduleTarget(campaign);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth((m) => subMonths(m, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h3 className="font-heading font-semibold text-base capitalize">
              {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
            </h3>
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-border">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="text-center text-xs font-semibold text-muted-foreground py-2.5 bg-muted/20">
                {wd}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: startDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[90px] border-b border-r border-border bg-muted/5" />
            ))}

            {days.map((day, idx) => {
              const dayCampaigns = getCampaignsForDay(day);
              const isToday = isSameDay(day, today);
              const isWeekend = getDay(day) === 0 || getDay(day) === 6;

              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "min-h-[90px] border-b border-r border-border p-1.5 transition-colors group relative cursor-pointer hover:bg-primary/5",
                    isToday && "bg-primary/5",
                    isWeekend && !isToday && "bg-muted/10",
                  )}
                  onClick={() => onCreateAtDate?.(day)}
                >
                  {/* Day number + add button */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={cn(
                        "text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full",
                        isToday
                          ? "bg-primary text-primary-foreground font-bold"
                          : "text-muted-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateAtDate?.(day);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-primary/10"
                      title="Nova campanha neste dia"
                    >
                      <Plus className="h-3.5 w-3.5 text-primary" />
                    </button>
                  </div>

                  {/* Campaign pills */}
                  <div className="space-y-0.5">
                    {dayCampaigns.slice(0, 3).map((c) => {
                      const cfg = statusConfig[c.status] || statusConfig.draft;
                      const dotColor = STATUS_COLORS[c.status] || STATUS_COLORS.draft;
                      const time = c.scheduled_at ? format(new Date(c.scheduled_at), "HH:mm") : "";
                      const isRecurring = !!c.settings?.recurrence;
                      const canReschedule = c.status === "draft" || c.status === "scheduled";

                      return (
                        <Tooltip key={c.id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCampaignClick?.(c);
                              }}
                              className={cn(
                                "w-full text-left rounded-md px-1.5 py-0.5 text-[10px] font-medium truncate transition-all flex items-center gap-1",
                                "bg-card border border-border shadow-sm hover:shadow-md hover:scale-[1.02]",
                              )}
                            >
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
                              <span className="truncate">
                                {isRecurring && "🔄 "}{time ? `${time} ` : ""}{c.name}
                              </span>
                              {canReschedule && (
                                <CalendarClock
                                  className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                                  onClick={(e) => openReschedule(c, e)}
                                />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px]">
                            <p className="font-semibold">{c.name}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={cn("w-2 h-2 rounded-full", dotColor)} />
                              <span>{cfg.label}</span>
                            </div>
                            {isRecurring && (
                              <p className="mt-0.5">
                                🔄 {c.settings.recurrence.type === "daily" ? "Diária" : c.settings.recurrence.type === "weekly" ? "Semanal" : "Mensal"}
                              </p>
                            )}
                            {time && <p className="mt-0.5">⏰ {time}</p>}
                            {c.stats && (
                              <p className="mt-0.5 text-muted-foreground">
                                {(c.stats as any).sent || 0}/{(c.stats as any).total || 0} enviadas
                              </p>
                            )}
                            {canReschedule && <p className="mt-1 text-primary">Clique no 📅 para reagendar</p>}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    {dayCampaigns.length > 3 && (
                      <span className="text-[10px] text-muted-foreground px-1.5 font-medium">
                        +{dayCampaigns.length - 3} mais
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-3">
            {Object.entries(statusConfig).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5 text-[11px]">
                <span className={cn("w-2 h-2 rounded-full", STATUS_COLORS[key] || STATUS_COLORS.draft)} />
                <span className="text-muted-foreground">{cfg.label}</span>
              </div>
            ))}
          </div>

          {scheduledCampaigns.length === 0 && (
            <div className="text-center py-10 px-4">
              <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhuma campanha agendada. Clique em qualquer dia para criar uma.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reschedule Dialog */}
      <Dialog open={!!rescheduleTarget} onOpenChange={(open) => !open && setRescheduleTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Reagendar Campanha
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Reagendando: <strong className="text-foreground">{rescheduleTarget?.name}</strong>
            </p>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={newDate}
                onSelect={setNewDate}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                className="p-3 pointer-events-auto"
                locale={ptBR}
              />
            </div>
            <div className="space-y-2">
              <Label>Horário</Label>
              <Input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRescheduleTarget(null)}>Cancelar</Button>
            <Button onClick={handleReschedule} disabled={!newDate || saving}>
              {saving ? "Salvando..." : "Reagendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
