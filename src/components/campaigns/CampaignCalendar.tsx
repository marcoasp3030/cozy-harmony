import { useMemo } from "react";
import { format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type Campaign, statusConfig } from "./CampaignCard";

interface CampaignCalendarProps {
  campaigns: Campaign[];
  onCampaignClick?: (campaign: Campaign) => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function CampaignCalendar({ campaigns, onCampaignClick }: CampaignCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

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
      // Check recurrence
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

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
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

        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="text-center text-xs font-medium text-muted-foreground py-2">
              {wd}
            </div>
          ))}

          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[70px]" />
          ))}

          {days.map((day) => {
            const dayCampaigns = getCampaignsForDay(day);
            const isToday = isSameDay(day, today);

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-[70px] rounded-lg border border-transparent p-1 transition-colors",
                  isToday && "border-primary bg-primary/5",
                  dayCampaigns.length > 0 && "bg-muted/30",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-medium",
                    isToday ? "text-primary font-bold" : "text-muted-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {dayCampaigns.slice(0, 2).map((c) => {
                    const cfg = statusConfig[c.status] || statusConfig.draft;
                    const time = c.scheduled_at ? format(new Date(c.scheduled_at), "HH:mm") : "";
                    const isRecurring = !!c.settings?.recurrence;
                    return (
                      <Tooltip key={c.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onCampaignClick?.(c)}
                            className={cn(
                              "w-full text-left rounded px-1 py-0.5 text-[10px] font-medium truncate transition-colors hover:opacity-80",
                              cfg.className,
                            )}
                          >
                            {isRecurring && "🔄 "}{time ? `${time} ` : ""}{c.name}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-semibold">{c.name}</p>
                          <p>{cfg.label}{isRecurring ? ` · Recorrente (${c.settings.recurrence.type === "daily" ? "diária" : c.settings.recurrence.type === "weekly" ? "semanal" : "mensal"})` : ""}</p>
                          {time && <p>Horário: {time}</p>}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {dayCampaigns.length > 2 && (
                    <span className="text-[10px] text-muted-foreground px-1">
                      +{dayCampaigns.length - 2} mais
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {scheduledCampaigns.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Nenhuma campanha agendada. Crie uma campanha com agendamento para visualizá-la aqui.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
