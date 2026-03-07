import { cn } from "@/lib/utils";
import { CheckCheck, Check, Clock, AlertCircle, ImageIcon, FileText, Mic, Download, Play, Pause, MousePointerClick, ListOrdered, Link, Phone, SmilePlus, RotateCcw, Trash2, ChevronDown, Copy } from "lucide-react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

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
  metadata?: any;
}

const statusIcon = (status: string | null) => {
  switch (status) {
    case "read": case "played": return <CheckCheck className="h-3.5 w-3.5 text-info" />;
    case "delivered": return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
    case "sent": return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
    case "error": case "failed": return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    default: return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
};

const formatMessageTime = (dateStr: string) =>
  new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏", "🎉", "👎"];

/** Audio player component */
const AudioPlayer = ({ src, isOutbound }: { src: string; isOutbound: boolean }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => {
          if (audioRef.current) setProgress(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full shrink-0", isOutbound ? "text-primary-foreground hover:bg-primary-foreground/20" : "text-foreground hover:bg-accent")}
        onClick={toggle}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <div className="flex-1 space-y-1">
        <div className="h-1 rounded-full bg-current/20 overflow-hidden">
          <div
            className="h-full rounded-full bg-current/60 transition-all"
            style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : "0%" }}
          />
        </div>
        <span className="text-[10px] opacity-70">{duration > 0 ? formatDuration(progress || duration) : "0:00"}</span>
      </div>
    </div>
  );
};

/** Image with lightbox */
const ImageMessage = ({ src }: { src: string }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <img
        src={src}
        alt="Imagem"
        className="max-w-full max-h-[300px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity object-cover"
        onClick={() => setExpanded(true)}
        loading="lazy"
      />
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpanded(false)}
        >
          <img src={src} alt="Imagem ampliada" className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" />
        </div>
      )}
    </>
  );
};

/** Document preview */
const DocumentMessage = ({ url, content, isOutbound }: { url: string; content: string | null; isOutbound: boolean }) => {
  const filename = content || url.split("/").pop() || "Documento";
  const isPdf = url.toLowerCase().endsWith(".pdf");

  return (
    <div className="space-y-1">
      <div className={cn(
        "flex items-center gap-2 rounded-lg p-2",
        isOutbound ? "bg-primary-foreground/10" : "bg-accent"
      )}>
        <FileText className="h-8 w-8 shrink-0 opacity-60" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{filename}</p>
          <p className="text-[10px] opacity-60">{isPdf ? "PDF" : "Documento"}</p>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </a>
      </div>
    </div>
  );
};

/** Reaction item type */
interface ReactionItem {
  emoji: string;
  from?: string;
}

/** Parse reactions from metadata — supports both legacy single `reaction` and new `reactions` array */
const getReactions = (metadata: any): ReactionItem[] => {
  if (!metadata) return [];
  if (Array.isArray(metadata.reactions) && metadata.reactions.length > 0) {
    return metadata.reactions;
  }
  if (metadata.reaction) {
    return [{ emoji: metadata.reaction, from: metadata.reactionFrom || 'me' }];
  }
  return [];
};

/** Group reactions by emoji for display */
const groupReactions = (reactions: ReactionItem[]): { emoji: string; count: number }[] => {
  const map = new Map<string, number>();
  for (const r of reactions) {
    map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
  }
  return Array.from(map.entries()).map(([emoji, count]) => ({ emoji, count }));
};

/** Emoji reaction badges */
const ReactionBadges = ({ reactions, isOutbound }: { reactions: ReactionItem[]; isOutbound: boolean }) => {
  const grouped = groupReactions(reactions);
  if (grouped.length === 0) return null;
  return (
    <div className={cn(
      "absolute -bottom-3 flex gap-0.5",
      isOutbound ? "right-1" : "left-1"
    )}>
      {grouped.map(({ emoji, count }) => (
        <span
          key={emoji}
          className="text-sm bg-card border border-border rounded-full px-1.5 py-0.5 shadow-sm cursor-default select-none flex items-center gap-0.5"
        >
          {emoji}{count > 1 && <span className="text-[10px] text-muted-foreground">{count}</span>}
        </span>
      ))}
    </div>
  );
};

/** Renders a single chat message with rich media */
const MessageBubble = ({ msg, onReact, onRetry, onDelete }: { msg: Message; onReact?: (msgId: string, emoji: string) => void; onRetry?: (msg: Message) => void; onDelete?: (msg: Message) => void }) => {
  const isOutbound = msg.direction === "outbound";
  const isNote = msg.type === "note";
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const reactions = getReactions(msg.metadata);

  const handleReact = (emoji: string) => {
    setEmojiOpen(false);
    onReact?.(msg.id, emoji);
  };

  const handleCopy = () => {
    if (msg.content) {
      navigator.clipboard.writeText(msg.content);
      toast.success("Texto copiado");
    }
  };

  if (isNote) {
    return (
      <div id={`msg-${msg.id}`} className="flex justify-center mb-2">
        <div className="max-w-[80%] rounded-lg bg-warning/10 border border-warning/20 px-3 py-2">
          <p className="text-xs font-medium text-warning mb-0.5">📝 Nota interna</p>
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          <p className="text-[10px] text-muted-foreground mt-1 text-right">{formatMessageTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  const showActions = hovered || menuOpen || emojiOpen;

  return (
    <div
      className={cn("flex mb-1 group relative", isOutbound ? "justify-end" : "justify-start")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!menuOpen && !emojiOpen) setHovered(false); }}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3.5 py-2 relative",
          isOutbound ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md",
          reactions.length > 0 && "mb-4"
        )}
      >
        {/* WhatsApp-style dropdown chevron - inside the bubble, top right */}
        {showActions && (
          <div className={cn(
            "absolute top-1 z-10",
            isOutbound ? "right-1" : "right-1"
          )}>
            <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); if (!open && !emojiOpen) setHovered(false); }}>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "h-5 w-5 flex items-center justify-center rounded-full transition-colors",
                    isOutbound
                      ? "hover:bg-primary-foreground/20 text-primary-foreground/70"
                      : "hover:bg-foreground/10 text-muted-foreground"
                  )}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isOutbound ? "end" : "start"} className="min-w-[160px]">
                {/* Emoji reactions row */}
                {onReact && (
                  <>
                    <div className="flex gap-0.5 px-2 py-1.5 flex-wrap">
                      {QUICK_EMOJIS.slice(0, 6).map((emoji) => (
                        <button
                          key={emoji}
                          className="text-lg hover:scale-125 transition-transform p-0.5 rounded hover:bg-accent"
                          onClick={() => { handleReact(emoji); setMenuOpen(false); }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}

                {/* Copy text */}
                {msg.content && (
                  <DropdownMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar texto
                  </DropdownMenuItem>
                )}

                {/* Retry for failed */}
                {isOutbound && (msg.status === "error" || msg.status === "failed") && onRetry && (
                  <DropdownMenuItem onClick={() => onRetry(msg)}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reenviar
                  </DropdownMenuItem>
                )}

                {/* Delete message */}
                {isOutbound && onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        if (window.confirm(msg.external_id ? "Apagar mensagem para todos?" : "Apagar mensagem?")) {
                          onDelete(msg);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {msg.external_id ? "Apagar para todos" : "Apagar mensagem"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Media content */}
        {msg.media_url && (
          <div className="mb-1.5">
            {msg.type === "image" ? (
              <ImageMessage src={msg.media_url} />
            ) : msg.type === "audio" || msg.type === "ptt" ? (
              <AudioPlayer src={msg.media_url} isOutbound={isOutbound} />
            ) : msg.type === "video" ? (
              <video
                src={msg.media_url}
                controls
                className="max-w-full max-h-[300px] rounded-lg"
                preload="metadata"
              />
            ) : msg.type === "document" ? (
              <DocumentMessage url={msg.media_url} content={msg.content} isOutbound={isOutbound} />
            ) : msg.type === "sticker" ? (
              <img src={msg.media_url} alt="Sticker" className="max-w-[150px] max-h-[150px]" loading="lazy" />
            ) : (
              <div className="flex items-center gap-2 text-xs opacity-75">
                <FileText className="h-3.5 w-3.5" />
                <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="underline">
                  {msg.type}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Text content */}
        {msg.content && !(msg.type === "document" && msg.media_url) && msg.type !== "interactive" && (
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        )}

        {/* Interactive message rendering */}
        {msg.type === "interactive" && msg.metadata && (
          <div>
            {msg.metadata.header && (
              <p className="text-sm font-bold mb-1">{msg.metadata.header}</p>
            )}
            <p className="text-sm whitespace-pre-wrap">{msg.metadata.body || msg.content}</p>
            {msg.metadata.footer && (
              <p className="text-[11px] text-muted-foreground mt-1">{msg.metadata.footer}</p>
            )}
            {msg.metadata.buttons && msg.metadata.buttons.length > 0 && (
              <div className={cn("mt-2 border-t", isOutbound ? "border-primary-foreground/20" : "border-border/40")}>
                {msg.metadata.buttons.map((btn: any, i: number) => (
                  <div key={i} className={cn("text-center py-1.5 text-xs font-medium", isOutbound ? "text-primary-foreground/80" : "text-primary", i < msg.metadata.buttons.length - 1 && (isOutbound ? "border-b border-primary-foreground/10" : "border-b border-border/30"))}>
                    {btn.title}
                  </div>
                ))}
              </div>
            )}
            {msg.metadata.listButtonText && (
              <div className={cn("mt-2 border-t text-center py-1.5 text-xs font-medium flex items-center justify-center gap-1", isOutbound ? "border-primary-foreground/20 text-primary-foreground/80" : "border-border/40 text-primary")}>
                <ListOrdered className="h-3 w-3" />
                {msg.metadata.listButtonText}
              </div>
            )}
            {msg.metadata.ctaButtons && msg.metadata.ctaButtons.length > 0 && (
              <div className={cn("mt-2 border-t", isOutbound ? "border-primary-foreground/20" : "border-border/40")}>
                {msg.metadata.ctaButtons.map((btn: any, i: number) => (
                  <div key={i} className={cn("text-center py-1.5 text-xs font-medium flex items-center justify-center gap-1", isOutbound ? "text-primary-foreground/80" : "text-primary")}>
                    {btn.type === "url" ? <Link className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                    {btn.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timestamp + status */}
        <div className={cn(
          "flex items-center justify-end gap-1 mt-0.5",
          isOutbound ? "text-primary-foreground/60" : "text-muted-foreground"
        )}>
          <span className="text-[10px]">{formatMessageTime(msg.created_at)}</span>
          {isOutbound && statusIcon(msg.status)}
        </div>

        {/* Retry button for failed messages - inline */}
        {isOutbound && (msg.status === "error" || msg.status === "failed") && onRetry && (
          <button
            onClick={() => onRetry(msg)}
            className={cn(
              "flex items-center gap-1 mt-1 text-[11px] font-medium rounded-md px-2 py-0.5 transition-colors",
              "bg-destructive/10 text-destructive hover:bg-destructive/20"
            )}
          >
            <RotateCcw className="h-3 w-3" />
            Reenviar
          </button>
        )}

        {/* Reaction badges */}
        {reactions.length > 0 && <ReactionBadges reactions={reactions} isOutbound={isOutbound} />}
      </div>
    </div>
  );
};

export default MessageBubble;
export type { Message };
