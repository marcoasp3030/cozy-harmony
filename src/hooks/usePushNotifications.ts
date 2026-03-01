import { useCallback, useEffect, useRef } from "react";

const PERMISSION_KEY = "push_notifications_enabled";

/** Check if push is enabled by user preference */
export const isPushEnabled = () => localStorage.getItem(PERMISSION_KEY) !== "false";

/** Request browser notification permission and store preference */
export const requestPushPermission = async (): Promise<boolean> => {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    localStorage.setItem(PERMISSION_KEY, "true");
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  const granted = result === "granted";
  localStorage.setItem(PERMISSION_KEY, String(granted));
  return granted;
};

interface PushOptions {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
  onClick?: () => void;
}

export const sendPushNotification = ({ title, body, tag, icon, onClick }: PushOptions) => {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!isPushEnabled()) return;
  // Only notify if tab is not focused
  if (document.hasFocus()) return;

  try {
    const notification = new Notification(title, {
      body,
      tag, // prevents duplicate notifications with same tag
      icon: icon || "/favicon.ico",
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick?.();
    };

    // Auto-close after 8 seconds
    setTimeout(() => notification.close(), 8000);
  } catch {
    // Notification API not available (e.g. insecure context)
  }
};

/**
 * Hook that listens to realtime events and sends push notifications
 * for: new inbound messages, SLA warnings, critical occurrences
 */
export const usePushNotifications = () => {
  const permissionRef = useRef(Notification?.permission);

  useEffect(() => {
    // Auto-request permission on mount if user previously enabled
    if (isPushEnabled() && "Notification" in window && Notification.permission === "default") {
      requestPushPermission().then((granted) => {
        permissionRef.current = granted ? "granted" : "denied";
      });
    }
  }, []);

  const notifyNewMessage = useCallback((contactName: string, content: string, contactPhone?: string) => {
    sendPushNotification({
      title: `💬 ${contactName || contactPhone || "Nova mensagem"}`,
      body: content?.slice(0, 120) || "Nova mensagem recebida",
      tag: `msg-${contactPhone || "unknown"}`,
      onClick: () => {
        // Navigate to inbox
        if (!window.location.pathname.startsWith("/inbox")) {
          window.location.href = "/inbox";
        }
      },
    });
  }, []);

  const notifySlaWarning = useCallback((contactName: string, remaining: string, expired: boolean) => {
    sendPushNotification({
      title: expired ? `⏰ SLA Excedido` : `⚠️ SLA próximo de expirar`,
      body: expired
        ? `O SLA de ${contactName} foi ultrapassado.`
        : `Restam ${remaining} do SLA de ${contactName}.`,
      tag: `sla-${contactName}`,
      onClick: () => {
        if (!window.location.pathname.startsWith("/inbox")) {
          window.location.href = "/inbox";
        }
      },
    });
  }, []);

  const notifyCriticalOccurrence = useCallback((storeName: string, type: string, description: string) => {
    sendPushNotification({
      title: `🚨 Ocorrência Crítica — ${storeName}`,
      body: `${type}: ${description.slice(0, 100)}`,
      tag: `occ-${storeName}-${Date.now()}`,
      onClick: () => {
        if (!window.location.pathname.startsWith("/occurrences")) {
          window.location.href = "/occurrences";
        }
      },
    });
  }, []);

  return { notifyNewMessage, notifySlaWarning, notifyCriticalOccurrence };
};
