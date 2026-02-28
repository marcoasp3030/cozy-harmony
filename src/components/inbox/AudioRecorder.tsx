import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Trash2, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { uploadMediaFile } from "./MediaUploader";

interface AudioRecorderProps {
  onSend: (audioUrl: string, durationSecs: number) => Promise<void>;
  disabled?: boolean;
}

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const AudioRecorder = ({ onSend, disabled }: AudioRecorderProps) => {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer opus/ogg for WhatsApp PTT compatibility, fallback to webm
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg; codecs=opus")
        ? "audio/ogg; codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm; codecs=opus")
        ? "audio/webm; codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100); // collect data every 100ms
      setRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      toast.error("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const ext = recorder.mimeType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        resolve(blob);
      };

      recorder.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setRecording(false);
    });
  }, []);

  const handleCancel = useCallback(async () => {
    await stopRecording();
    setDuration(0);
    chunksRef.current = [];
  }, [stopRecording]);

  const handleSend = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      toast.error("Nenhum áudio gravado");
      return;
    }

    setUploading(true);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type });
      const url = await uploadMediaFile(file);
      await onSend(url, duration);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar áudio");
    } finally {
      setUploading(false);
      setDuration(0);
      chunksRef.current = [];
    }
  }, [stopRecording, onSend, duration]);

  if (uploading) {
    return (
      <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9" disabled>
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </Button>
    );
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
        {/* Cancel */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-9 w-9 text-destructive hover:text-destructive"
          title="Cancelar gravação"
          onClick={handleCancel}
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        {/* Recording indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/20">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-sm font-mono text-destructive font-medium min-w-[36px]">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Send */}
        <Button
          size="icon"
          className="shrink-0 h-9 w-9 bg-primary"
          title="Enviar áudio"
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 h-9 w-9"
      title="Gravar áudio"
      onClick={startRecording}
      disabled={disabled}
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
};

export default AudioRecorder;
