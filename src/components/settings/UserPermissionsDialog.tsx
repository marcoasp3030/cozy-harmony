import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Shield, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ALL_PAGES, PAGE_LABELS, type PageKey } from "@/hooks/useUserPermissions";

interface FeatureToggle {
  key: string;
  label: string;
  group: string;
}

const FEATURE_TOGGLES: FeatureToggle[] = [
  { key: "can_create_campaigns", label: "Criar campanhas", group: "Campanhas" },
  { key: "can_execute_campaigns", label: "Executar campanhas", group: "Campanhas" },
  { key: "can_delete_campaigns", label: "Excluir campanhas", group: "Campanhas" },
  { key: "can_create_contacts", label: "Criar contatos", group: "Contatos" },
  { key: "can_edit_contacts", label: "Editar contatos", group: "Contatos" },
  { key: "can_delete_contacts", label: "Excluir contatos", group: "Contatos" },
  { key: "can_create_automations", label: "Criar automações", group: "Automações" },
  { key: "can_edit_automations", label: "Editar automações", group: "Automações" },
  { key: "can_delete_automations", label: "Excluir automações", group: "Automações" },
  { key: "can_manage_templates", label: "Gerenciar templates", group: "Templates" },
  { key: "can_view_reports", label: "Visualizar relatórios", group: "Relatórios" },
  { key: "can_manage_funnels", label: "Gerenciar funis", group: "Funis" },
  { key: "can_manage_occurrences", label: "Gerenciar ocorrências", group: "Ocorrências" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
}

export function UserPermissionsDialog({ open, onOpenChange, userId, userName }: Props) {
  const queryClient = useQueryClient();
  const [allowedPages, setAllowedPages] = useState<string[]>([...ALL_PAGES]);
  const [features, setFeatures] = useState<Record<string, boolean>>({});

  const { data: existing, isLoading } = useQuery({
    queryKey: ["user-permissions-edit", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_permissions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      return data;
    },
    enabled: open && !!userId,
  });

  useEffect(() => {
    if (existing) {
      setAllowedPages(existing.allowed_pages as string[]);
      const featureMap: Record<string, boolean> = {};
      FEATURE_TOGGLES.forEach((ft) => {
        featureMap[ft.key] = (existing as any)[ft.key] ?? true;
      });
      setFeatures(featureMap);
    } else {
      setAllowedPages([...ALL_PAGES]);
      const featureMap: Record<string, boolean> = {};
      FEATURE_TOGGLES.forEach((ft) => {
        featureMap[ft.key] = ft.key.includes("delete") ? false : true;
      });
      setFeatures(featureMap);
    }
  }, [existing, open]);

  const togglePage = (page: string) => {
    setAllowedPages((prev) =>
      prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]
    );
  };

  const toggleFeature = (key: string) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAllPages = () => setAllowedPages([...ALL_PAGES]);
  const deselectAllPages = () => setAllowedPages(["dashboard"]); // always keep dashboard

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        user_id: userId,
        allowed_pages: allowedPages,
        ...features,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { error } = await supabase
          .from("user_permissions")
          .update(payload)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_permissions")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["user-permissions-edit", userId] });
      toast.success("Permissões salvas!");
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao salvar permissões"),
  });

  const groups = FEATURE_TOGGLES.reduce((acc, ft) => {
    if (!acc[ft.group]) acc[ft.group] = [];
    acc[ft.group].push(ft);
    return acc;
  }, {} as Record<string, FeatureToggle[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Permissões de {userName}
          </DialogTitle>
          <DialogDescription>
            Defina quais páginas e funcionalidades este usuário pode acessar.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Page access */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="flex items-center gap-1.5 text-sm font-semibold">
                  <Eye className="h-4 w-4" />
                  Páginas com acesso
                </Label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAllPages}>
                    Todas
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={deselectAllPages}>
                    Nenhuma
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                {ALL_PAGES.map((page) => (
                  <label key={page} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={allowedPages.includes(page)}
                      onCheckedChange={() => togglePage(page)}
                      disabled={page === "dashboard"} // dashboard always accessible
                    />
                    {PAGE_LABELS[page]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                O Dashboard está sempre disponível.
              </p>
            </div>

            <Separator />

            {/* Feature permissions */}
            <div>
              <Label className="flex items-center gap-1.5 text-sm font-semibold mb-3">
                <FileText className="h-4 w-4" />
                Funcionalidades
              </Label>
              <div className="space-y-4">
                {Object.entries(groups).map(([groupName, toggles]) => (
                  <div key={groupName}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {groupName}
                    </p>
                    <div className="space-y-1.5 rounded-lg border p-3">
                      {toggles.map((ft) => (
                        <label key={ft.key} className="flex items-center gap-2 cursor-pointer text-sm">
                          <Checkbox
                            checked={features[ft.key] ?? true}
                            onCheckedChange={() => toggleFeature(ft.key)}
                          />
                          {ft.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Permissões
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
