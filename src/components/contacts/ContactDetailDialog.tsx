import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Tag } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneDisplay } from "@/lib/validators";
import TagManager from "./TagManager";

interface ContactDetail {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  about: string | null;
  is_blocked: boolean | null;
  created_at: string;
  last_message_at: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactDetail | null;
  onEdit: () => void;
  onDeleted: () => void;
}

export default function ContactDetailDialog({ open, onOpenChange, contact, onEdit, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const handleDelete = async () => {
    if (!contact) return;
    setDeleting(true);
    try {
      await supabase.from("contact_tags").delete().eq("contact_id", contact.id);
      const { error } = await supabase.from("contacts").delete().eq("id", contact.id);
      if (error) throw error;
      toast.success("Contato excluído.");
      onOpenChange(false);
      onDeleted();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + (err.message || ""));
    } finally {
      setDeleting(false);
    }
  };

  const handleBlock = async () => {
    if (!contact) return;
    setBlocking(true);
    const newVal = !contact.is_blocked;
    await supabase.from("contacts").update({ is_blocked: newVal }).eq("id", contact.id);
    contact.is_blocked = newVal;
    setBlocking(false);
    toast.success(newVal ? "Contato bloqueado." : "Contato desbloqueado.");
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Detalhes do Contato</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border divide-y divide-border">
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">Nome</p>
              <p className="font-medium">{contact.name || "Sem nome"}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">Telefone</p>
              <p className="font-mono">{formatPhoneDisplay(contact.phone)}</p>
            </div>
            {contact.email && (
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">Email</p>
                <p>{contact.email}</p>
              </div>
            )}
            {contact.about && (
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">Observações</p>
                <p className="text-sm">{contact.about}</p>
              </div>
            )}
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">Criado em</p>
              <p className="text-sm">{new Date(contact.created_at).toLocaleString("pt-BR")}</p>
            </div>
            {contact.last_message_at && (
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">Última mensagem</p>
                <p className="text-sm">{new Date(contact.last_message_at).toLocaleString("pt-BR")}</p>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" /> Tags
            </Label>
            <TagManager contactId={contact.id} />
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>Editar</Button>
            <Button variant="outline" size="sm" onClick={handleBlock} disabled={blocking}>
              {contact.is_blocked ? "Desbloquear" : "Bloquear"}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Excluir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
