import { useState, useRef, useCallback } from "react";
import { Paperclip, Image, FileText, Mic, Video, X, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MediaAttachment {
  file: File;
  preview: string | null;
  type: "image" | "video" | "audio" | "document";
}

const getMediaType = (file: File): MediaAttachment["type"] => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB

interface MediaUploaderProps {
  attachment: MediaAttachment | null;
  onAttach: (attachment: MediaAttachment) => void;
  onRemove: () => void;
  disabled?: boolean;
}

const MediaUploader = ({ attachment, onAttach, onRemove, disabled }: MediaUploaderProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [acceptType, setAcceptType] = useState("");

  const handleFileSelect = useCallback((accept: string) => {
    setAcceptType(accept);
    setMenuOpen(false);
    // Need a small delay for the accept attribute to update
    setTimeout(() => fileInputRef.current?.click(), 50);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`Arquivo muito grande (máx ${formatFileSize(MAX_FILE_SIZE)})`);
      return;
    }

    const type = getMediaType(file);
    let preview: string | null = null;

    if (type === "image" || type === "video") {
      preview = URL.createObjectURL(file);
    }

    onAttach({ file, preview, type });
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onAttach]);

  const menuItems = [
    { icon: Image, label: "Imagem", accept: "image/*", color: "text-blue-500" },
    { icon: Video, label: "Vídeo", accept: "video/*", color: "text-purple-500" },
    { icon: Mic, label: "Áudio", accept: "audio/*", color: "text-green-500" },
    { icon: FileText, label: "Documento", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar", color: "text-orange-500" },
  ];

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={acceptType}
        onChange={handleFileChange}
      />

      {attachment ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9 text-primary"
            title="Remover anexo"
            onClick={onRemove}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-9 w-9"
              title="Anexar mídia"
              disabled={disabled}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start" side="top">
            {menuItems.map((item) => (
              <button
                key={item.label}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => handleFileSelect(item.accept)}
              >
                <item.icon className={cn("h-4 w-4", item.color)} />
                <span>{item.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};

/** Preview bar shown above textarea when a file is attached */
const AttachmentPreview = ({ attachment, onRemove, uploading }: { attachment: MediaAttachment; onRemove: () => void; uploading: boolean }) => {
  return (
    <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-lg bg-muted/50 border border-border">
      {/* Thumbnail */}
      {attachment.type === "image" && attachment.preview && (
        <img src={attachment.preview} alt="Preview" className="h-12 w-12 rounded-md object-cover shrink-0" />
      )}
      {attachment.type === "video" && attachment.preview && (
        <video src={attachment.preview} className="h-12 w-12 rounded-md object-cover shrink-0" />
      )}
      {attachment.type === "audio" && (
        <div className="h-12 w-12 rounded-md bg-green-500/10 flex items-center justify-center shrink-0">
          <Mic className="h-5 w-5 text-green-500" />
        </div>
      )}
      {attachment.type === "document" && (
        <div className="h-12 w-12 rounded-md bg-orange-500/10 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-orange-500" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{attachment.file.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatFileSize(attachment.file.size)} • {attachment.type === "image" ? "Imagem" : attachment.type === "video" ? "Vídeo" : attachment.type === "audio" ? "Áudio" : "Documento"}
        </p>
      </div>

      {uploading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};

/** Upload file to storage and return public URL */
const uploadMediaFile = async (file: File): Promise<string> => {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from("chat-media").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) throw new Error(`Upload falhou: ${error.message}`);

  const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(path);
  return urlData.publicUrl;
};

export { MediaUploader, AttachmentPreview, uploadMediaFile, getMediaType, formatFileSize };
export type { MediaAttachment };
