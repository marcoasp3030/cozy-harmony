import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Tag, X, Check, Loader2, Palette } from "lucide-react";

interface TagItem {
  id: string;
  name: string;
  color: string;
}

interface TagManagerProps {
  contactId: string;
  /** Externally provided tags already assigned (optional, will fetch if not given) */
  assignedTags?: TagItem[];
  /** Compact mode shows only badges inline */
  compact?: boolean;
  onChanged?: () => void;
}

const PRESET_TAG_COLORS = [
  "#22c55e", "#16a34a", "#3b82f6", "#6366f1",
  "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444",
  "#f97316", "#f59e0b", "#14b8a6", "#06b6d4",
  "#64748b", "#78716c",
];

export default function TagManager({ contactId, assignedTags, compact, onChanged }: TagManagerProps) {
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [contactTagIds, setContactTagIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(PRESET_TAG_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: tags }, { data: ct }] = await Promise.all([
      supabase.from("tags").select("id, name, color").order("name"),
      supabase.from("contact_tags").select("tag_id").eq("contact_id", contactId),
    ]);
    setAllTags((tags || []) as TagItem[]);
    setContactTagIds(new Set((ct || []).map((r) => r.tag_id)));
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    if (contactId) loadData();
  }, [contactId, loadData]);

  const toggleTag = async (tagId: string) => {
    const isAssigned = contactTagIds.has(tagId);
    if (isAssigned) {
      await supabase.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId);
      setContactTagIds((prev) => { const n = new Set(prev); n.delete(tagId); return n; });
    } else {
      await supabase.from("contact_tags").insert({ contact_id: contactId, tag_id: tagId });
      setContactTagIds((prev) => new Set(prev).add(tagId));
    }
    onChanged?.();
  };

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("tags")
      .insert({ name, color: newTagColor })
      .select("id, name, color")
      .single();
    if (error) {
      toast.error(error.code === "23505" ? "Tag já existe" : "Erro ao criar tag");
      setCreating(false);
      return;
    }
    const newTag = data as TagItem;
    setAllTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
    // Auto-assign to current contact
    await supabase.from("contact_tags").insert({ contact_id: contactId, tag_id: newTag.id });
    setContactTagIds((prev) => new Set(prev).add(newTag.id));
    setNewTagName("");
    setCreating(false);
    toast.success(`Tag "${name}" criada e vinculada!`);
    onChanged?.();
  };

  const assignedTagObjects = allTags.filter((t) => contactTagIds.has(t.id));
  const unassignedTags = allTags.filter((t) => !contactTagIds.has(t.id));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando tags...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Assigned tags */}
      <div className="flex flex-wrap gap-1.5">
        {assignedTagObjects.map((tag) => (
          <Badge
            key={tag.id}
            className="cursor-pointer group transition-all text-xs gap-1 pr-1.5 hover:opacity-80"
            style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}
            variant="outline"
            onClick={() => toggleTag(tag.id)}
          >
            {tag.name}
            <X className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
          </Badge>
        ))}

        {/* Add tag popover */}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] rounded-full border-dashed gap-1 text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              {compact ? "" : "Tag"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start" side="bottom">
            <div className="p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" /> Gerenciar Tags
              </p>

              {/* Existing tags to toggle */}
              {allTags.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {allTags.map((tag) => {
                    const isActive = contactTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          "flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-xs transition-colors text-left",
                          isActive
                            ? "bg-accent/50 font-medium"
                            : "hover:bg-muted/60"
                        )}
                      >
                        <div
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {isActive && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Create new tag */}
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Criar nova tag</p>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Nome da tag"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    className="h-7 text-xs flex-1"
                    maxLength={30}
                    onKeyDown={(e) => e.key === "Enter" && createTag()}
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2"
                    onClick={createTag}
                    disabled={creating || !newTagName.trim()}
                  >
                    {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </Button>
                </div>
                {/* Color picker */}
                <div className="flex flex-wrap gap-1">
                  {PRESET_TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewTagColor(c)}
                      className={cn(
                        "h-5 w-5 rounded-full transition-all hover:scale-110",
                        newTagColor === c && "ring-2 ring-offset-1 ring-primary"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
