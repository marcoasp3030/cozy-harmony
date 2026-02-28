import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";
import { useRef, useState } from "react";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  profile_picture: string | null;
  about: string | null;
  is_blocked: boolean | null;
}

interface Message {
  id: string;
  contact_id: string | null;
  direction: string;
  type: string;
  content: string | null;
  media_url: string | null;
  status: string | null;
  created_at: string;
  external_id: string | null;
}

interface Conversation {
  id: string;
  contact_id: string;
  status: string;
  unread_count: number | null;
  last_message_at: string | null;
  notes: string | null;
  contact?: Contact;
  lastMessage?: Message;
}

interface KanbanViewProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
  onReload: () => void;
}

const columns = [
  { id: "open", label: "Abertas", color: "bg-success", dotColor: "bg-success" },
  { id: "waiting", label: "Aguardando", color: "bg-warning", dotColor: "bg-warning" },
  { id: "resolved", label: "Resolvidas", color: "bg-muted-foreground", dotColor: "bg-muted-foreground" },
];

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 172800000) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

const KanbanView = ({ conversations, onSelectConversation, onReload }: KanbanViewProps) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, convId: string) => {
    setDraggedId(convId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", convId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(colId);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const convId = e.dataTransfer.getData("text/plain");
    if (!convId) return;

    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.status === newStatus) {
      setDraggedId(null);
      return;
    }

    const { error } = await supabase
      .from("conversations")
      .update({ status: newStatus })
      .eq("id", convId);

    if (error) {
      toast.error("Erro ao mover conversa");
    } else {
      const labels: Record<string, string> = { open: "Aberta", waiting: "Aguardando", resolved: "Resolvida" };
      toast.success(`Conversa movida para ${labels[newStatus] || newStatus}`);
      onReload();
    }
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverCol(null);
  };

  return (
    <div className="grid h-[calc(100vh-220px)] grid-cols-3 gap-4">
      {columns.map((col) => {
        const items = conversations.filter((c) => c.status === col.id);
        const isDragOver = dragOverCol === col.id;

        return (
          <div
            key={col.id}
            className={cn(
              "flex flex-col rounded-xl border border-border bg-card transition-colors",
              isDragOver && "border-primary/50 bg-primary/5"
            )}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column Header */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <div className={cn("h-2.5 w-2.5 rounded-full", col.dotColor)} />
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <Badge variant="secondary" className="ml-auto text-xs h-5 min-w-[20px] flex items-center justify-center rounded-full">
                {items.length}
              </Badge>
            </div>

            {/* Column Content */}
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    Nenhuma conversa
                  </div>
                ) : (
                  items.map((conv) => (
                    <div
                      key={conv.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, conv.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onSelectConversation(conv.id)}
                      className={cn(
                        "group cursor-pointer rounded-lg border border-border bg-background p-3 transition-all hover:shadow-md hover:border-primary/30",
                        draggedId === conv.id && "opacity-40 scale-95"
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <GripVertical className="h-4 w-4 mt-0.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
                        <Avatar className="h-9 w-9 shrink-0">
                          {conv.contact?.profile_picture && (
                            <AvatarImage src={conv.contact.profile_picture} />
                          )}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(conv.contact?.name || null, conv.contact?.phone || "")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium truncate">
                              {conv.contact?.name || conv.contact?.phone || "Desconhecido"}
                            </span>
                            {(conv.unread_count ?? 0) > 0 && (
                              <Badge className="h-4 min-w-[16px] shrink-0 rounded-full p-0 text-[10px] flex items-center justify-center ml-1">
                                {conv.unread_count}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {conv.lastMessage?.content || (conv.lastMessage?.type !== "text" ? `📎 ${conv.lastMessage?.type}` : "Sem mensagens")}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {conv.last_message_at ? formatTime(conv.last_message_at) : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
};

export default KanbanView;
