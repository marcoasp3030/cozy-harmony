import { useState, useEffect, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import TagManager from "@/components/contacts/TagManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  User,
  Phone,
  Mail,
  Calendar,
  Tag,
  MessageSquare,
  StickyNote,
  Save,
  UserCheck,
  Shield,
  ShieldOff,
  Clock,
  Hash,
} from "lucide-react";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  profile_picture: string | null;
  about: string | null;
  is_blocked: boolean | null;
  email?: string | null;
  created_at?: string;
  custom_fields?: Record<string, any> | null;
}

interface TagItem {
  id: string;
  name: string;
  color: string;
}

interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

interface ContactPanelProps {
  contact: Contact | null;
  conversationId: string | null;
  conversationStatus: string;
  conversationNotes: string | null;
  assignedTo: string | null;
  contactTags: TagItem[];
  onReload: () => void;
}

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

const ContactPanel = ({
  contact,
  conversationId,
  conversationStatus,
  conversationNotes,
  assignedTo,
  contactTags,
  onReload,
}: ContactPanelProps) => {
  const [notes, setNotes] = useState(conversationNotes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [msgCount, setMsgCount] = useState<number>(0);

  useEffect(() => {
    setNotes(conversationNotes || "");
  }, [conversationNotes]);

  // Load team profiles
  useEffect(() => {
    supabase.from("profiles").select("id, user_id, name, email, avatar_url").then(({ data }) => {
      setProfiles((data as Profile[]) || []);
    });
  }, []);

  // Load message count
  useEffect(() => {
    if (!contact) return;
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contact.id)
      .then(({ count }) => setMsgCount(count || 0));
  }, [contact?.id]);

  const saveNotes = async () => {
    if (!conversationId) return;
    setSavingNotes(true);
    const { error } = await supabase
      .from("conversations")
      .update({ notes: notes.trim() || null })
      .eq("id", conversationId);
    if (error) toast.error("Erro ao salvar notas");
    else toast.success("Notas salvas!");
    setSavingNotes(false);
  };

  const updateStatus = async (newStatus: string) => {
    if (!conversationId) return;
    await supabase.from("conversations").update({ status: newStatus }).eq("id", conversationId);
    const labels: Record<string, string> = { open: "Aberta", in_progress: "Em Atendimento", waiting: "Aguardando", resolved: "Resolvida" };
    toast.success(`Status: ${labels[newStatus]}`);
    onReload();
  };

  const assignAgent = async (userId: string) => {
    if (!conversationId) return;
    const val = userId === "none" ? null : userId;
    await supabase.from("conversations").update({ assigned_to: val }).eq("id", conversationId);
    toast.success(val ? "Atendente atribuído" : "Atendente removido");
    onReload();
  };

  const toggleBlock = async () => {
    if (!contact) return;
    const newVal = !contact.is_blocked;
    await supabase.from("contacts").update({ is_blocked: newVal }).eq("id", contact.id);
    toast.success(newVal ? "Contato bloqueado" : "Contato desbloqueado");
    onReload();
  };

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm p-4">
        Selecione uma conversa
      </div>
    );
  }

  const customFields = contact.custom_fields && typeof contact.custom_fields === "object"
    ? Object.entries(contact.custom_fields as Record<string, any>).filter(([, v]) => v !== null && v !== "")
    : [];

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        {/* Profile */}
        <div className="flex flex-col items-center text-center">
          <Avatar className="h-16 w-16">
            {contact.profile_picture && <AvatarImage src={contact.profile_picture} />}
            <AvatarFallback className="bg-primary/10 text-primary text-lg">
              {getInitials(contact.name, contact.phone)}
            </AvatarFallback>
          </Avatar>
          <h3 className="mt-3 font-heading font-semibold">{contact.name || "Sem nome"}</h3>
          {contact.about && <p className="text-xs text-muted-foreground italic mt-0.5">{contact.about}</p>}
        </div>

        <Separator />

        {/* Contact Info */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><User className="h-3 w-3" /> Informações</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {contact.phone}</div>
            {contact.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {contact.email}</div>}
            <div className="flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5 text-muted-foreground" /> {msgCount} mensagens</div>
            {contact.created_at && (
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs">Desde {new Date(contact.created_at).toLocaleDateString("pt-BR")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Custom Fields */}
        {customFields.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><Hash className="h-3 w-3" /> Campos personalizados</p>
              <div className="space-y-1 text-sm">
                {customFields.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-muted-foreground capitalize">{key}</span>
                    <span className="font-medium">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Tags */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</p>
          <TagManager contactId={contact.id} compact onChanged={onReload} />
        </div>

        <Separator />

        {/* Status */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><Clock className="h-3 w-3" /> Status</p>
          <Select value={conversationStatus} onValueChange={updateStatus}>
            <SelectTrigger className="w-full h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">🟢 Aberta</SelectItem>
              <SelectItem value="in_progress">🔵 Em Atendimento</SelectItem>
              <SelectItem value="waiting">🟡 Aguardando</SelectItem>
              <SelectItem value="resolved">⚫ Resolvida</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Agent Assignment */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><UserCheck className="h-3 w-3" /> Atendente</p>
          <Select value={assignedTo || "none"} onValueChange={assignAgent}>
            <SelectTrigger className="w-full h-8 text-sm">
              <SelectValue placeholder="Nenhum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Notes */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><StickyNote className="h-3 w-3" /> Notas da conversa</p>
          <Textarea
            placeholder="Adicione notas sobre esta conversa..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[60px] text-sm resize-none"
            rows={3}
          />
          <Button size="sm" variant="outline" onClick={saveNotes} disabled={savingNotes} className="w-full">
            <Save className="h-3.5 w-3.5 mr-1.5" /> Salvar notas
          </Button>
        </div>

        <Separator />

        {/* Actions */}
        <Button
          variant="outline"
          className={cn("w-full", contact.is_blocked ? "" : "text-destructive")}
          size="sm"
          onClick={toggleBlock}
        >
          {contact.is_blocked ? <><ShieldOff className="h-3.5 w-3.5 mr-1.5" /> Desbloquear</> : <><Shield className="h-3.5 w-3.5 mr-1.5" /> Bloquear</>}
        </Button>
      </div>
    </ScrollArea>
  );
};

export default ContactPanel;
