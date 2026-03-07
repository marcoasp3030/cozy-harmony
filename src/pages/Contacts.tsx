import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Upload, Search, MoreHorizontal, Trash2, Loader2,
  ChevronLeft, ChevronRight, Filter, Tag, X, Users, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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

interface TagItem {
  id: string;
  name: string;
  color: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const Contacts = () => {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const queryClient = useQueryClient();

  // Load tags
  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("id, name, color").order("name");
      return (data || []) as TagItem[];
    },
  });

  // Get filtered contact IDs when tags are selected
  const { data: tagFilteredIds } = useQuery({
    queryKey: ["contact-tag-filter", selectedTagIds],
    queryFn: async () => {
      if (selectedTagIds.length === 0) return null;
      const { data } = await supabase
        .from("contact_tags")
        .select("contact_id")
        .in("tag_id", selectedTagIds);
      const ids = [...new Set((data || []).map((d) => d.contact_id))];
      return ids as string[];
    },
    enabled: selectedTagIds.length > 0,
  });

  const hasTagFilter = selectedTagIds.length > 0;
  const filteredByTags = hasTagFilter ? (tagFilteredIds || []) : null;

  const { data: totalCount = 0 } = useQuery({
    queryKey: ["contacts-count", search, filteredByTags],
    queryFn: async () => {
      if (hasTagFilter && filteredByTags && filteredByTags.length === 0) return 0;

      let query = supabase
        .from("contacts")
        .select("id", { count: "exact", head: true });

      if (search.trim()) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (filteredByTags && filteredByTags.length > 0) {
        query = query.in("id", filteredByTags);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts", search, page, pageSize, filteredByTags],
    queryFn: async () => {
      if (hasTagFilter && filteredByTags && filteredByTags.length === 0) return [];

      const from = page * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("contacts")
        .select("id, name, phone, email, about, is_blocked, created_at, last_message_at")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (search.trim()) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (filteredByTags && filteredByTags.length > 0) {
        query = query.in("id", filteredByTags);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Contact[];
    },
  });

  // Load tags for each visible contact
  const contactIds = contacts.map((c) => c.id);
  const { data: contactTagsMap = {} } = useQuery({
    queryKey: ["contact-tags-map", contactIds],
    queryFn: async () => {
      if (contactIds.length === 0) return {};
      const { data } = await supabase
        .from("contact_tags")
        .select("contact_id, tag_id")
        .in("contact_id", contactIds);
      const map: Record<string, string[]> = {};
      (data || []).forEach((ct) => {
        if (!map[ct.contact_id]) map[ct.contact_id] = [];
        map[ct.contact_id].push(ct.tag_id);
      });
      return map;
    },
    enabled: contactIds.length > 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["contacts-count"] });
    queryClient.invalidateQueries({ queryKey: ["contact-tags-map"] });
    queryClient.invalidateQueries({ queryKey: ["contact-tag-filter"] });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
    setSelected([]);
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setPage(0);
    setSelected([]);
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
    setPage(0);
    setSelected([]);
  };

  const clearTagFilter = () => {
    setSelectedTagIds([]);
    setPage(0);
    setSelected([]);
  };

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

  const handleBulkAddTag = async (tagId: string) => {
    try {
      const rows = selected.map((contactId) => ({
        contact_id: contactId,
        tag_id: tagId,
      }));
      // Use upsert to avoid duplicate key errors
      const { error } = await supabase.from("contact_tags").upsert(rows, {
        onConflict: "contact_id,tag_id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
      const tag = tags.find((t) => t.id === tagId);
      toast.success(`Tag "${tag?.name}" adicionada a ${selected.length} contato(s).`);
      invalidate();
      setBulkTagOpen(false);
    } catch (err: any) {
      toast.error("Erro ao adicionar tag: " + (err.message || ""));
    }
  };

  const handleBulkRemoveTag = async (tagId: string) => {
    try {
      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .in("contact_id", selected)
        .eq("tag_id", tagId);
      if (error) throw error;
      const tag = tags.find((t) => t.id === tagId);
      toast.success(`Tag "${tag?.name}" removida de ${selected.length} contato(s).`);
      invalidate();
      setBulkTagOpen(false);
    } catch (err: any) {
      toast.error("Erro ao remover tag: " + (err.message || ""));
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

  const fromItem = totalCount > 0 ? page * pageSize + 1 : 0;
  const toItem = Math.min((page + 1) * pageSize, totalCount);

  const getTagById = (id: string) => tags.find((t) => t.id === id);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold">Contatos</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Gerencie seus contatos e segmente por tags
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

      {/* Tag Filter Bar */}
      {tags.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
                <Filter className="h-3.5 w-3.5" />
                Segmentar por tags:
              </div>
              {tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant={selectedTagIds.includes(tag.id) ? "default" : "outline"}
                  className="cursor-pointer transition-all text-xs"
                  style={
                    selectedTagIds.includes(tag.id)
                      ? { backgroundColor: tag.color, color: "#fff", borderColor: tag.color }
                      : { borderColor: tag.color + "80", color: tag.color }
                  }
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                </Badge>
              ))}
              {selectedTagIds.length > 0 && (
                <>
                  <Separator orientation="vertical" className="h-5" />
                  <button
                    onClick={clearTagFilter}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Limpar filtros
                  </button>
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Users className="h-3 w-3" />
                    {totalCount} contato(s)
                  </Badge>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between flex-wrap gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone ou email..."
                className="pl-9"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{totalCount} contato(s)</span>
              {selected.length > 0 && (
                <>
                  <Badge variant="secondary">{selected.length} selecionado(s)</Badge>

                  {/* Bulk Tag Actions */}
                  <Popover open={bulkTagOpen} onOpenChange={setBulkTagOpen}>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Tag className="h-3.5 w-3.5" />
                        Tags
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="end">
                      <div className="p-3 border-b border-border">
                        <p className="text-sm font-medium">Adicionar tag</p>
                        <p className="text-xs text-muted-foreground">
                          Aplicar a {selected.length} contato(s)
                        </p>
                      </div>
                      <div className="p-2 max-h-48 overflow-y-auto space-y-1">
                        {tags.map((tag) => (
                          <button
                            key={tag.id}
                            onClick={() => handleBulkAddTag(tag.id)}
                            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            {tag.name}
                            <Plus className="h-3 w-3 ml-auto text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                      <Separator />
                      <div className="p-3 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Remover tag</p>
                        <div className="flex flex-wrap gap-1">
                          {tags.map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="outline"
                              className="cursor-pointer text-[10px] hover:bg-destructive/10 hover:text-destructive transition-colors"
                              style={{ borderColor: tag.color, color: tag.color }}
                              onClick={() => handleBulkRemoveTag(tag.id)}
                            >
                              <X className="h-2.5 w-2.5 mr-0.5" />
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

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
                <TableHead>Tags</TableHead>
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
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  </TableRow>
                ))
              ) : contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {hasTagFilter
                      ? "Nenhum contato encontrado com as tags selecionadas."
                      : "Nenhum contato encontrado. Importe uma lista ou crie manualmente."}
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

                  const contactTagIds = contactTagsMap[contact.id] || [];

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
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {contactTagIds.slice(0, 3).map((tagId) => {
                            const tag = getTagById(tagId);
                            if (!tag) return null;
                            return (
                              <Badge
                                key={tagId}
                                variant="outline"
                                className="text-[10px] py-0 px-1.5"
                                style={{ borderColor: tag.color, color: tag.color }}
                              >
                                {tag.name}
                              </Badge>
                            );
                          })}
                          {contactTagIds.length > 3 && (
                            <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                              +{contactTagIds.length - 3}
                            </Badge>
                          )}
                        </div>
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
                            <DropdownMenuSeparator />
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

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Exibindo {fromItem}–{toItem} de {totalCount}</span>
              <span className="mx-1">•</span>
              <span>Por página:</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-7 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                Página {page + 1} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
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