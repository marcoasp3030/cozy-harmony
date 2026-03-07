import { useState, useMemo, useCallback } from "react";
import { Loader2, Merge, Trash2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneDisplay } from "@/lib/validators";

interface DuplicateContact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  about: string | null;
  created_at: string;
  last_message_at: string | null;
}

interface DuplicateGroup {
  normalizedPhone: string;
  contacts: DuplicateContact[];
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0+/, "");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}

export default function DuplicateContactsDialog({ open, onOpenChange, onMerged }: Props) {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [scanned, setScanned] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [keepIds, setKeepIds] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [mergedCount, setMergedCount] = useState(0);

  const scan = useCallback(async () => {
    setLoading(true);
    setScanned(false);
    setGroups([]);
    setMergedCount(0);
    try {
      // Fetch all contacts
      let allContacts: DuplicateContact[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("contacts")
          .select("id, name, phone, email, about, created_at, last_message_at")
          .order("created_at", { ascending: true })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allContacts = allContacts.concat(data as DuplicateContact[]);
        if (data.length < batchSize) break;
        from += batchSize;
      }

      // Group by normalized phone
      const phoneMap = new Map<string, DuplicateContact[]>();
      for (const c of allContacts) {
        const norm = normalizePhone(c.phone);
        if (!norm) continue;
        // Also try without country code (last 10-11 digits)
        const short = norm.length > 11 ? norm.slice(-11) : norm;
        const key = short;
        if (!phoneMap.has(key)) phoneMap.set(key, []);
        phoneMap.get(key)!.push(c);
      }

      const duplicates: DuplicateGroup[] = [];
      for (const [normalizedPhone, contacts] of phoneMap) {
        if (contacts.length > 1) {
          duplicates.push({ normalizedPhone, contacts });
        }
      }

      // Sort: largest groups first
      duplicates.sort((a, b) => b.contacts.length - a.contacts.length);

      // Pre-select the "best" contact to keep (most recent message or most data)
      const defaults: Record<string, string> = {};
      for (const group of duplicates) {
        const best = group.contacts.reduce((a, b) => {
          // Prefer one with name
          if (a.name && !b.name) return a;
          if (!a.name && b.name) return b;
          // Prefer one with email
          if (a.email && !b.email) return a;
          if (!a.email && b.email) return b;
          // Prefer most recent message
          const aMsg = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const bMsg = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return bMsg > aMsg ? b : a;
        });
        defaults[group.normalizedPhone] = best.id;
      }
      setKeepIds(defaults);
      setGroups(duplicates);
      setScanned(true);
    } catch (err: any) {
      toast.error("Erro ao escanear: " + (err.message || ""));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-scan on open
  const handleOpenChange = (val: boolean) => {
    if (val && !scanned && !loading) {
      scan();
    }
    onOpenChange(val);
  };

  const mergeGroup = async (group: DuplicateGroup) => {
    const keepId = keepIds[group.normalizedPhone];
    if (!keepId) {
      toast.error("Selecione qual contato manter.");
      return;
    }

    setMerging(group.normalizedPhone);
    try {
      const removeIds = group.contacts.filter((c) => c.id !== keepId).map((c) => c.id);
      const keepContact = group.contacts.find((c) => c.id === keepId)!;

      // Merge data: fill missing fields from duplicates into the kept contact
      const updates: Record<string, any> = {};
      for (const dup of group.contacts) {
        if (dup.id === keepId) continue;
        if (!keepContact.name && dup.name) updates.name = dup.name;
        if (!keepContact.email && dup.email) updates.email = dup.email;
        if (!keepContact.about && dup.about) updates.about = dup.about;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("contacts").update(updates).eq("id", keepId);
      }

      // Move tags from duplicates to kept contact
      const { data: dupTags } = await supabase
        .from("contact_tags")
        .select("tag_id")
        .in("contact_id", removeIds);
      if (dupTags && dupTags.length > 0) {
        const uniqueTags = [...new Set(dupTags.map((t) => t.tag_id))];
        const tagRows = uniqueTags.map((tagId) => ({
          contact_id: keepId,
          tag_id: tagId,
        }));
        await supabase.from("contact_tags").upsert(tagRows, {
          onConflict: "contact_id,tag_id",
          ignoreDuplicates: true,
        });
      }

      // Move conversations from duplicates to kept contact
      await supabase.from("conversations").update({ contact_id: keepId }).in("contact_id", removeIds);

      // Move messages from duplicates to kept contact
      await supabase.from("messages").update({ contact_id: keepId }).in("contact_id", removeIds);

      // Move campaign_contacts from duplicates to kept contact
      await supabase.from("campaign_contacts").update({ contact_id: keepId }).in("contact_id", removeIds);

      // Delete duplicate contact_tags
      await supabase.from("contact_tags").delete().in("contact_id", removeIds);

      // Delete duplicate contacts
      const { error } = await supabase.from("contacts").delete().in("id", removeIds);
      if (error) throw error;

      toast.success(`${removeIds.length} duplicata(s) mesclada(s)!`);
      setGroups((prev) => prev.filter((g) => g.normalizedPhone !== group.normalizedPhone));
      setMergedCount((prev) => prev + removeIds.length);
      onMerged();
    } catch (err: any) {
      toast.error("Erro ao mesclar: " + (err.message || ""));
    } finally {
      setMerging(null);
    }
  };

  const mergeAll = async () => {
    for (const group of groups) {
      await mergeGroup(group);
    }
  };

  const totalDuplicates = groups.reduce((sum, g) => sum + g.contacts.length - 1, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="font-heading text-xl flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Detectar Contatos Duplicados
          </DialogTitle>
          <DialogDescription>
            Identifica contatos com o mesmo telefone (normalizado) e permite mesclar mantendo os dados mais completos.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Escaneando contatos...</p>
            </div>
          ) : !scanned ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Button onClick={scan}>Escanear Duplicados</Button>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <CheckCircle2 className="h-12 w-12 text-success" />
              <p className="text-lg font-semibold">Nenhum duplicado encontrado!</p>
              {mergedCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  {mergedCount} duplicata(s) mesclada(s) nesta sessão.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-sm">
                    {groups.length} grupo(s) · {totalDuplicates} duplicata(s)
                  </Badge>
                  {mergedCount > 0 && (
                    <Badge variant="secondary" className="text-sm gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {mergedCount} mesclada(s)
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={mergeAll}
                  disabled={!!merging}
                >
                  <Merge className="mr-1.5 h-3.5 w-3.5" />
                  Mesclar Todos
                </Button>
              </div>

              <ScrollArea className="max-h-[50vh]">
                <div className="space-y-3 pr-2">
                  {groups.map((group) => {
                    const isExpanded = expandedGroup === group.normalizedPhone;
                    const isMerging = merging === group.normalizedPhone;

                    return (
                      <Card key={group.normalizedPhone} className="border">
                        <CardContent className="p-0">
                          {/* Group header */}
                          <button
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                            onClick={() => setExpandedGroup(isExpanded ? null : group.normalizedPhone)}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono text-xs">
                                {formatPhoneDisplay(group.contacts[0].phone)}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {group.contacts.length} contatos
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={isMerging}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  mergeGroup(group);
                                }}
                              >
                                {isMerging ? (
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                ) : (
                                  <Merge className="mr-1 h-3 w-3" />
                                )
                                }
                                Mesclar
                              </Button>
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </button>

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="border-t border-border p-3 space-y-2">
                              <p className="text-xs text-muted-foreground mb-2">
                                Selecione qual contato <strong>manter</strong> (os outros serão mesclados nele):
                              </p>
                              <RadioGroup
                                value={keepIds[group.normalizedPhone] || ""}
                                onValueChange={(val) =>
                                  setKeepIds((prev) => ({ ...prev, [group.normalizedPhone]: val }))
                                }
                              >
                                {group.contacts.map((c) => (
                                  <div
                                    key={c.id}
                                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${keepIds[group.normalizedPhone] === c.id
                                      ? "border-primary bg-primary/5"
                                      : "border-border"
                                      }`}
                                  >
                                    <RadioGroupItem value={c.id} id={c.id} className="mt-0.5" />
                                    <Label htmlFor={c.id} className="flex-1 cursor-pointer space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">
                                          {c.name || "Sem nome"}
                                        </span>
                                        {keepIds[group.normalizedPhone] === c.id && (
                                          <Badge className="text-[10px] bg-primary/15 text-primary border-primary/30" variant="outline">
                                            Manter
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                                        <span className="font-mono">{formatPhoneDisplay(c.phone)}</span>
                                        {c.email && <span>{c.email}</span>}
                                        <span>Criado: {new Date(c.created_at).toLocaleDateString("pt-BR")}</span>
                                        {c.last_message_at && (
                                          <span>
                                            Última msg: {new Date(c.last_message_at).toLocaleDateString("pt-BR")}
                                          </span>
                                        )}
                                      </div>
                                    </Label>
                                  </div>
                                ))}
                              </RadioGroup>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
