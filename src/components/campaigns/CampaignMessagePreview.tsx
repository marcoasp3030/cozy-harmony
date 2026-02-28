import { type InteractiveMessage } from "@/components/shared/InteractiveMessageBuilder";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Video, FileAudio, File, ExternalLink, Phone, List, BarChart3 } from "lucide-react";

interface CampaignMessagePreviewProps {
  messageType: string;
  messageContent: string;
  mediaUrl?: string;
  interactive: InteractiveMessage;
}

export default function CampaignMessagePreview({
  messageType,
  messageContent,
  mediaUrl,
  interactive,
}: CampaignMessagePreviewProps) {
  const hasInteractive = interactive.type !== "none";
  const bodyText = hasInteractive ? (interactive.body || messageContent) : messageContent;

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground text-center">
        Prévia de como a mensagem será exibida no WhatsApp
      </p>

      {/* Phone frame */}
      <div className="w-full max-w-[340px] mx-auto">
        <div className="rounded-2xl border-2 border-border bg-[hsl(var(--muted)/0.3)] overflow-hidden shadow-lg">
          {/* WhatsApp header bar */}
          <div className="bg-[hsl(var(--primary))] px-4 py-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">C</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-primary-foreground text-sm font-semibold truncate">Contato</p>
              <p className="text-primary-foreground/70 text-[10px]">online</p>
            </div>
          </div>

          {/* Chat area */}
          <div className="p-3 min-h-[200px] flex flex-col justify-end gap-2"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          >
            {/* Message bubble */}
            <div className="self-end max-w-[85%]">
              <div className="rounded-lg rounded-tr-sm bg-[hsl(142,70%,87%)] dark:bg-[hsl(142,30%,25%)] p-2 shadow-sm">
                {/* Media preview */}
                {messageType !== "text" && mediaUrl && (
                  <div className="mb-1.5 rounded bg-black/10 dark:bg-white/10 flex items-center justify-center h-32 overflow-hidden">
                    {messageType === "image" ? (
                      <img src={mediaUrl} alt="preview" className="h-full w-full object-cover rounded" onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex flex-col items-center gap-1 text-muted-foreground"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span class="text-[10px]">Imagem</span></div>';
                      }} />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-foreground/50">
                        {messageType === "video" && <Video className="h-6 w-6" />}
                        {messageType === "audio" && <FileAudio className="h-6 w-6" />}
                        {messageType === "document" && <File className="h-6 w-6" />}
                        <span className="text-[10px] capitalize">{messageType}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Header (interactive) */}
                {hasInteractive && interactive.header && (
                  <p className="text-xs font-bold text-foreground mb-1">{interactive.header}</p>
                )}

                {/* Body text */}
                {bodyText && (
                  <p className="text-[13px] text-foreground whitespace-pre-wrap break-words leading-snug">
                    {bodyText}
                  </p>
                )}

                {/* Footer (interactive) */}
                {hasInteractive && interactive.footer && (
                  <p className="text-[11px] text-muted-foreground mt-1">{interactive.footer}</p>
                )}

                {/* Timestamp */}
                <div className="flex justify-end mt-0.5">
                  <span className="text-[10px] text-muted-foreground/70">
                    {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    {" "}✓✓
                  </span>
                </div>
              </div>

              {/* Interactive elements below bubble */}
              {hasInteractive && interactive.type === "buttons" && (
                <div className="mt-0.5 space-y-0.5">
                  {(interactive.buttons || []).slice(0, 3).map((btn, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-[hsl(142,70%,87%)] dark:bg-[hsl(142,30%,25%)] text-center py-2 shadow-sm"
                    >
                      <span className="text-xs font-medium text-[hsl(200,80%,45%)]">
                        {btn.title || `Opção ${i + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {hasInteractive && interactive.type === "list" && (
                <div className="mt-0.5">
                  <div className="rounded-lg bg-[hsl(142,70%,87%)] dark:bg-[hsl(142,30%,25%)] text-center py-2 shadow-sm flex items-center justify-center gap-1.5">
                    <List className="h-3.5 w-3.5 text-[hsl(200,80%,45%)]" />
                    <span className="text-xs font-medium text-[hsl(200,80%,45%)]">
                      {interactive.listButtonText || "Ver opções"}
                    </span>
                  </div>
                </div>
              )}

              {hasInteractive && interactive.type === "cta" && (
                <div className="mt-0.5 space-y-0.5">
                  {(interactive.ctaButtons || []).map((btn, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-[hsl(142,70%,87%)] dark:bg-[hsl(142,30%,25%)] text-center py-2 shadow-sm flex items-center justify-center gap-1.5"
                    >
                      {btn.type === "phone" ? (
                        <Phone className="h-3 w-3 text-[hsl(200,80%,45%)]" />
                      ) : (
                        <ExternalLink className="h-3 w-3 text-[hsl(200,80%,45%)]" />
                      )}
                      <span className="text-xs font-medium text-[hsl(200,80%,45%)]">
                        {btn.title || "Link"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {hasInteractive && interactive.type === "poll" && (
                <div className="mt-1.5 self-end max-w-full">
                  <div className="rounded-lg bg-[hsl(142,70%,87%)] dark:bg-[hsl(142,30%,25%)] p-2.5 shadow-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <BarChart3 className="h-3.5 w-3.5 text-foreground/70" />
                      <span className="text-xs font-bold text-foreground">
                        {interactive.pollName || "Enquete"}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(interactive.pollOptions || []).map((opt, i) => (
                        <div key={i} className="rounded-md border border-foreground/15 bg-background/30 px-2.5 py-1.5">
                          <span className="text-[11px] text-foreground">{opt.title || `Opção ${i + 1}`}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      {interactive.pollMultiSelect ? "Múltipla escolha" : "Escolha única"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        <Badge variant="outline" className="text-xs capitalize">{messageType}</Badge>
        {hasInteractive && (
          <Badge variant="default" className="text-xs">{interactive.type}</Badge>
        )}
        {mediaUrl && <Badge variant="outline" className="text-xs">Com mídia</Badge>}
      </div>
    </div>
  );
}
