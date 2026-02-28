import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

interface SlaConversation {
  id: string;
  last_message_at: string | null;
  sla_hours?: number | null;
  priority?: string;
  contact?: { name: string | null; phone: string } | null;
}

const SLA_CHECK_INTERVAL = 60_000; // check every minute
const SLA_WARNING_THRESHOLD = 0.75; // warn at 75% of SLA time elapsed

const playWarningSound = () => {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Warning tone: two descending beeps
    [0, 0.25].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.value = i === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.15, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.2);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  } catch {
    // Audio not available
  }
};

export const useSlaNotifications = (conversations: SlaConversation[]) => {
  const notifiedRef = useRef<Set<string>>(new Set());
  const expiredNotifiedRef = useRef<Set<string>>(new Set());

  const checkSla = useCallback(() => {
    const soundEnabled = localStorage.getItem("notifications_sound") !== "false";

    for (const conv of conversations) {
      if (!conv.sla_hours || !conv.last_message_at) continue;

      const elapsed = (Date.now() - new Date(conv.last_message_at).getTime()) / 3_600_000;
      const ratio = elapsed / conv.sla_hours;
      const contactName = conv.contact?.name || conv.contact?.phone || "Contato";

      // SLA expired
      if (ratio >= 1 && !expiredNotifiedRef.current.has(conv.id)) {
        expiredNotifiedRef.current.add(conv.id);
        notifiedRef.current.add(conv.id); // skip warning if already expired
        toast.error(`⏰ SLA Excedido — ${contactName}`, {
          description: `O SLA de ${conv.sla_hours}h foi ultrapassado.`,
          duration: 8000,
        });
        if (soundEnabled) playWarningSound();
      }
      // SLA warning (75%+)
      else if (ratio >= SLA_WARNING_THRESHOLD && ratio < 1 && !notifiedRef.current.has(conv.id)) {
        notifiedRef.current.add(conv.id);
        const remaining = conv.sla_hours - elapsed;
        const remainingLabel =
          remaining < 1
            ? `${Math.round(remaining * 60)}min`
            : `${Math.round(remaining)}h`;

        toast.warning(`⚠️ SLA próximo de expirar — ${contactName}`, {
          description: `Restam ${remainingLabel} do SLA de ${conv.sla_hours}h.`,
          duration: 6000,
        });
        if (soundEnabled) playWarningSound();
      }
    }
  }, [conversations]);

  useEffect(() => {
    // Reset notifications when conversations change significantly
    const currentIds = new Set(conversations.map((c) => c.id));
    for (const id of notifiedRef.current) {
      if (!currentIds.has(id)) notifiedRef.current.delete(id);
    }
    for (const id of expiredNotifiedRef.current) {
      if (!currentIds.has(id)) expiredNotifiedRef.current.delete(id);
    }
  }, [conversations]);

  useEffect(() => {
    checkSla(); // run immediately
    const interval = setInterval(checkSla, SLA_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkSla]);
};
