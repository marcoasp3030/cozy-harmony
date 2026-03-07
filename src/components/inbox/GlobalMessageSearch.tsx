import { useState, useCallback, useRef } from "react";
import { Search, X, MessageSquare, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  content: string;
  created_at: string;
  direction: string;
  type: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_picture: string | null;
  conversation_id: string | null;
}

interface GlobalMessageSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (conversationId: string, messageId: string) => void;
}

const highlightText = (text: string, query: string) => {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-primary/30 text-foreground rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
};

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

const GlobalMessageSearch = ({ open, onOpenChange, onNavigate }: GlobalMessageSearchProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      // Search messages containing the term
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, content, created_at, direction, type, contact_id")
        .ilike("content", `%${term}%`)
        .not("type", "eq", "note")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!msgs || msgs.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }

      // Get unique contact IDs
      const contactIds = [...new Set(msgs.filter((m) => m.contact_id).map((m) => m.contact_id!))];
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name, phone, profile_picture")
        .in("id", contactIds);

      const contactMap = new Map(
        (contacts || []).map((c) => [c.id, c])
      );

      // Get conversation IDs for these contacts
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, contact_id")
        .in("contact_id", contactIds);

      const convMap = new Map(
        (convs || []).map((c) => [c.contact_id, c.id])
      );

      const enriched: SearchResult[] = msgs
        .filter((m) => m.contact_id && contactMap.has(m.contact_id))
        .map((m) => {
          const contact = contactMap.get(m.contact_id!)!;
          return {
            id: m.id,
            content: m.content || "",
            created_at: m.created_at,
            direction: m.direction,
            type: m.type,
            contact_id: m.contact_id!,
            contact_name: contact.name,
            contact_phone: contact.phone,
            contact_picture: contact.profile_picture,
            conversation_id: convMap.get(m.contact_id!) || null,
          };
        });

      setResults(enriched);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 400);
  };

  const handleClose = () => {
    setQuery("");
    setResults([]);
    setSearched(false);
    onOpenChange(false);
  };

  const handleSelect = (result: SearchResult) => {
    if (result.conversation_id) {
      onNavigate(result.conversation_id, result.id);
      handleClose();
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
      " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  // Group results by contact
  const groupedResults = results.reduce<Map<string, SearchResult[]>>((acc, r) => {
    const key = r.contact_id;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(r);
    return acc;
  }, new Map());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="text-base">Pesquisa Global de Mensagens</DialogTitle>
        </DialogHeader>

        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar em todas as conversas..."
              className="pl-9 pr-9"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              autoFocus
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => { setQuery(""); setResults([]); setSearched(false); }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-[400px] px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Pesquisando...</span>
            </div>
          ) : searched && results.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhuma mensagem encontrada para "{query}"
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {results.length} resultado{results.length !== 1 ? "s" : ""} encontrado{results.length !== 1 ? "s" : ""}
              </p>
              {[...groupedResults.entries()].map(([contactId, msgs]) => {
                const first = msgs[0];
                return (
                  <div key={contactId} className="space-y-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Avatar className="h-6 w-6">
                        {first.contact_picture && <AvatarImage src={first.contact_picture} />}
                        <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                          {getInitials(first.contact_name, first.contact_phone)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {first.contact_name || first.contact_phone}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {msgs.length} msg{msgs.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {msgs.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => handleSelect(r)}
                        disabled={!r.conversation_id}
                        className={cn(
                          "w-full text-left rounded-lg border border-border px-3 py-2 transition-colors",
                          r.conversation_id
                            ? "hover:bg-accent cursor-pointer"
                            : "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <MessageSquare className={cn(
                            "h-3.5 w-3.5 mt-0.5 shrink-0",
                            r.direction === "inbound" ? "text-muted-foreground" : "text-primary"
                          )} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-snug line-clamp-2">
                              {highlightText(r.content, query)}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {r.direction === "inbound" ? "Recebida" : "Enviada"} • {formatDate(r.created_at)}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Digite pelo menos 2 caracteres para pesquisar
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalMessageSearch;
