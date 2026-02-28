import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, Search, MoreHorizontal, Tag, Trash2, Send, Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneDisplay } from "@/lib/validators";
import ImportContactsDialog from "@/components/contacts/ImportContactsDialog";
import ContactFormDialog from "@/components/contacts/ContactFormDialog";
import ContactDetailDialog from "@/components/contacts/ContactDetailDialog";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  about: string | null;
  is_blocked: boolean | null;
  created_at: string;
  last_message_at: string | null;
}

const Contacts = () => {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts", search],
    queryFn: async () => {
      let query = supabase
        .from("contacts")
        .select("id, name, phone, email, about, is_blocked, created_at, last_message_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (search.trim()) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Contact[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["contacts"] });

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    setSelected(
      selected.length === contacts.length ? [] : contacts.map((c) => c.id)
    );
  };

  const openDetail = (contact: Contact) => {
    setDetailContact(contact);
    setDetailOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditContact(contact);
    setFormOpen(true);
    setDetailOpen(false);
  };

  const openNew = () => {
    setEditContact(null);
    setFormOpen(true);
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      // Delete related tags first
      await supabase.from("contact_tags").delete().in("contact_id", selected);
      const { error } = await supabase.from("contacts").delete().in("id", selected);
      if (error) throw error;
      toast.success(`${selected.length} contato(s) excluído(s).`);
      setSelected([]);
      invalidate();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + (err.message || ""));
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  const handleSingleDelete = async (id: string) => {
    await supabase.from("contact_tags").delete().eq("contact_id", id);
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir.");
    } else {
      toast.success("Contato excluído.");
      invalidate();
    }
  };

  const handleBlock = async (contact: Contact) => {
    const newVal = !contact.is_blocked;
    await supabase.from("contacts").update({ is_blocked: newVal }).eq("id", contact.id);
    toast.success(newVal ? "Contato bloqueado." : "Contato desbloqueado.");
    invalidate();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold">Contatos</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Gerencie seus contatos e listas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Importar</span>
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Novo Contato</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between flex-wrap gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone ou email..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{contacts.length} contato(s)</span>
              {selected.length > 0 && (
                <>
                  <Badge variant="secondary">{selected.length} selecionado(s)</Badge>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Excluir
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={contacts.length > 0 && selected.length === contacts.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  </TableRow>
                ))
              ) : contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nenhum contato encontrado. Importe uma lista ou crie manualmente.
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((contact) => {
                  const initials = (contact.name || contact.phone)
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <TableRow
                      key={contact.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(contact)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.includes(contact.id)}
                          onCheckedChange={() => toggleSelect(contact.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {contact.name || "Sem nome"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatPhoneDisplay(contact.phone)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {contact.email || "-"}
                      </TableCell>
                      <TableCell>
                        {contact.is_blocked ? (
                          <Badge variant="destructive" className="text-xs">Bloqueado</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-success/15 text-success text-xs">Ativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(contact.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(contact)}>
                              Ver detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(contact)}>
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBlock(contact)}>
                              {contact.is_blocked ? "Desbloquear" : "Bloquear"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleSingleDelete(contact.id)}
                            >
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <ImportContactsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={invalidate}
      />

      <ContactFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        onSaved={invalidate}
      />

      <ContactDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contact={detailContact}
        onEdit={() => detailContact && openEdit(detailContact)}
        onDeleted={invalidate}
      />

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.length} contato(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todos os contatos selecionados serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Contacts;
