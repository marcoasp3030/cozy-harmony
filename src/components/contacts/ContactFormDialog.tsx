import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { validatePhone, formatPhoneDisplay } from "@/lib/validators";

interface Contact {
  id?: string;
  name: string | null;
  phone: string;
  email: string | null;
  about: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  onSaved: () => void;
}

export default function ContactFormDialog({ open, onOpenChange, contact, onSaved }: Props) {
  const isEdit = !!contact?.id;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [about, setAbout] = useState("");
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  useEffect(() => {
    if (open) {
      setName(contact?.name || "");
      setPhone(contact?.phone ? formatPhoneDisplay(contact.phone) : "");
      setEmail(contact?.email || "");
      setAbout(contact?.about || "");
      setPhoneError("");
    }
  }, [open, contact]);

  const handleSave = async () => {
    const result = validatePhone(phone);
    if (!result.valid) {
      setPhoneError(result.error || "Telefone inválido");
      return;
    }
    setPhoneError("");

    setSaving(true);
    try {
      const payload = {
        name: name.trim() || null,
        phone: result.formatted,
        email: email.trim() || null,
        about: about.trim() || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("contacts").update(payload).eq("id", contact!.id!);
        if (error) throw error;
        toast.success("Contato atualizado!");
      } else {
        const { error } = await supabase.from("contacts").insert(payload);
        if (error) {
          if (error.code === "23505") {
            toast.error("Já existe um contato com este telefone.");
          } else {
            throw error;
          }
          setSaving(false);
          return;
        }
        toast.success("Contato criado!");
      }
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{isEdit ? "Editar Contato" : "Novo Contato"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className={phoneError ? "text-destructive" : ""}>Telefone *</Label>
            <Input
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(""); }}
              className={phoneError ? "border-destructive" : ""}
            />
            {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
          </div>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input placeholder="Nome do contato" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input placeholder="email@exemplo.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea placeholder="Anotações sobre o contato" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={500} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Criar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
