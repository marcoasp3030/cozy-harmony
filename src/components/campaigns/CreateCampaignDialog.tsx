import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon, ChevronLeft, ChevronRight, Users, FileText, Clock,
  CheckCircle2, Loader2, Search, X, ImageIcon, Video, FileAudio, File,
  Shield, Info, MessageSquare, Sparkles, Eye, Filter, TrendingUp, GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import InstanceSelector from "@/components/shared/InstanceSelector";
import InteractiveMessageBuilder, { getDefaultInteractive, type InteractiveMessage } from "@/components/shared/InteractiveMessageBuilder";
import CampaignMessagePreview from "@/components/campaigns/CampaignMessagePreview";

type Step = "info" | "recipients" | "message" | "preview" | "schedule" | "review";
const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: "info", label: "Informações", icon: <FileText className="h-4 w-4" /> },
  { key: "recipients", label: "Destinatários", icon: <Users className="h-4 w-4" /> },
  { key: "message", label: "Mensagem", icon: <FileText className="h-4 w-4" /> },
  { key: "preview", label: "Prévia", icon: <Eye className="h-4 w-4" /> },
  { key: "schedule", label: "Agendamento", icon: <Clock className="h-4 w-4" /> },
  { key: "review", label: "Revisão", icon: <CheckCircle2 className="h-4 w-4" /> },
];

interface Contact {
  id: string;
  name: string | null;
  phone: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Template {
  id: string;
  name: string;
  content: string;
  type: string;
  variables: string[] | null;
}

interface FunnelStage {
  id: string;
  name: string;
  color: string;
  funnel_id: string;
  funnel_name: string;
}

interface CampaignForm {
  name: string;
  description: string;
  selectedContactIds: string[];
  selectedTagIds: string[];
  selectedFunnelStageIds: string[];
  minScore: number;
  messageType: string;
  messageContent: string;
  mediaUrl: string;
  templateId: string | null;
  scheduleType: "now" | "scheduled";
  scheduledAt: Date | undefined;
  instanceId: string | null;
  // Anti-block settings
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  businessHoursOnly: boolean;
  warmUpEnabled: boolean;
  contentVariation: boolean;
  maxConsecutiveFailures: number;
  // Recurrence
  recurrenceEnabled: boolean;
  recurrenceType: "daily" | "weekly" | "monthly";
  // Interactive
  interactive: InteractiveMessage;
}

const initialForm: CampaignForm = {
  name: "",
  description: "",
  selectedContactIds: [],
  selectedTagIds: [],
  selectedFunnelStageIds: [],
  minScore: 0,
  messageType: "text",
  messageContent: "",
  mediaUrl: "",
  templateId: null,
  scheduleType: "now",
  scheduledAt: undefined,
  instanceId: null,
  delayMin: 3000,
  delayMax: 8000,
  dailyLimit: 200,
  businessHoursOnly: true,
  warmUpEnabled: false,
  contentVariation: true,
  maxConsecutiveFailures: 5,
  recurrenceEnabled: false,
  recurrenceType: "weekly",
  interactive: getDefaultInteractive(),
};

const messageTypeOptions = [
  { value: "text", label: "Texto", icon: <FileText className="h-4 w-4" /> },
  { value: "image", label: "Imagem", icon: <ImageIcon className="h-4 w-4" /> },
  { value: "video", label: "Vídeo", icon: <Video className="h-4 w-4" /> },
  { value: "audio", label: "Áudio", icon: <FileAudio className="h-4 w-4" /> },
  { value: "document", label: "Documento", icon: <File className="h-4 w-4" /> },
];

export default function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreated,
  editCampaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  editCampaign?: { id: string; name: string; description: string | null; message_type: string; message_content: string | null; media_url: string | null; instance_id: string | null; settings: any } | null;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("info");
  const [form, setForm] = useState<CampaignForm>(initialForm);
  const [saving, setSaving] = useState(false);

  // Data
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const isEditing = !!editCampaign;

  // Load data on open
  useEffect(() => {
    if (!open) return;
    setStep("info");
    if (editCampaign) {
      const s = editCampaign.settings || {};
      setForm({
        ...initialForm,
        name: editCampaign.name,
        description: editCampaign.description || "",
        messageType: editCampaign.message_type || "text",
        messageContent: editCampaign.message_content || "",
        mediaUrl: editCampaign.media_url || "",
        instanceId: editCampaign.instance_id || null,
        delayMin: s.delayMin ?? initialForm.delayMin,
        delayMax: s.delayMax ?? initialForm.delayMax,
        dailyLimit: s.dailyLimit ?? initialForm.dailyLimit,
        businessHoursOnly: s.businessHoursOnly ?? initialForm.businessHoursOnly,
        warmUpEnabled: s.warmUpEnabled ?? initialForm.warmUpEnabled,
        contentVariation: s.contentVariation ?? initialForm.contentVariation,
        maxConsecutiveFailures: s.maxConsecutiveFailures ?? initialForm.maxConsecutiveFailures,
        recurrenceEnabled: !!s.recurrence,
        recurrenceType: s.recurrence?.type || "weekly",
      });
    } else {
      setForm(initialForm);
    }
    loadData();
  }, [open]);

  // Listen for calendar pre-fill date event
  useEffect(() => {
    const handler = (e: Event) => {
      const date = (e as CustomEvent).detail as Date;
      if (date && !editCampaign) {
        date.setHours(9, 0, 0, 0);
        setForm((prev) => ({
          ...prev,
          scheduleType: "scheduled",
          scheduledAt: date,
        }));
      }
    };
    window.addEventListener("campaign-prefill-date", handler);
    return () => window.removeEventListener("campaign-prefill-date", handler);
  }, [editCampaign]);

  const loadData = async () => {
    setLoadingData(true);
    const [contactsRes, tagsRes, templatesRes, funnelsRes, stagesRes] = await Promise.all([
      supabase.from("contacts").select("id, name, phone").order("name"),
      supabase.from("tags").select("id, name, color"),
      supabase.from("templates").select("id, name, content, type, variables"),
      supabase.from("funnels").select("id, name"),
      supabase.from("funnel_stages").select("id, name, color, funnel_id").order("position"),
    ]);
    setContacts(contactsRes.data || []);
    setTags(tagsRes.data || []);
    setTemplates(templatesRes.data || []);

    const funnelMap = new Map((funnelsRes.data || []).map((f: any) => [f.id, f.name]));
    setFunnelStages(
      (stagesRes.data || []).map((s: any) => ({
        ...s,
        funnel_name: funnelMap.get(s.funnel_id) || "Funil",
      }))
    );
    setLoadingData(false);
  };

  const toggleFunnelStage = (id: string) => {
    update(
      "selectedFunnelStageIds",
      form.selectedFunnelStageIds.includes(id)
        ? form.selectedFunnelStageIds.filter((s) => s !== id)
        : [...form.selectedFunnelStageIds, id],
    );
  };

  // Estimate total contacts based on filters
  useEffect(() => {
    const estimate = async () => {
      const hasFilters = form.selectedTagIds.length > 0 || form.selectedFunnelStageIds.length > 0 || form.minScore > 0;
      if (!hasFilters && form.selectedContactIds.length === 0) {
        setEstimatedCount(null);
        return;
      }

      setCountLoading(true);
      try {
        const allIds = new Set(form.selectedContactIds);

        // Add contacts from tags
        if (form.selectedTagIds.length > 0) {
          const { data: tagContacts } = await supabase
            .from("contact_tags")
            .select("contact_id")
            .in("tag_id", form.selectedTagIds);
          tagContacts?.forEach((tc) => { if (tc.contact_id) allIds.add(tc.contact_id); });
        }

        // Add contacts from funnel stages
        if (form.selectedFunnelStageIds.length > 0) {
          const { data: convs } = await supabase
            .from("conversations")
            .select("contact_id")
            .in("funnel_stage_id", form.selectedFunnelStageIds);
          convs?.forEach((c) => { if (c.contact_id) allIds.add(c.contact_id); });
        }

        // Filter by min score
        if (form.minScore > 0 && allIds.size > 0) {
          const { data: scored } = await supabase
            .from("conversations")
            .select("contact_id")
            .in("contact_id", Array.from(allIds))
            .gte("score", form.minScore);
          const scoredIds = new Set((scored || []).map((s) => s.contact_id));
          // Keep only IDs that also pass score filter
          for (const id of allIds) {
            if (!scoredIds.has(id)) allIds.delete(id);
          }
        } else if (form.minScore > 0) {
          // Score filter with no other selection = all contacts with that score
          const { data: scored } = await supabase
            .from("conversations")
            .select("contact_id")
            .gte("score", form.minScore);
          scored?.forEach((s) => { if (s.contact_id) allIds.add(s.contact_id); });
        }

        setEstimatedCount(allIds.size);
      } catch {
        setEstimatedCount(null);
      } finally {
        setCountLoading(false);
      }
    };

    const timer = setTimeout(estimate, 300);
    return () => clearTimeout(timer);
  }, [form.selectedContactIds, form.selectedTagIds, form.selectedFunnelStageIds, form.minScore]);

  const update = useCallback(
    <K extends keyof CampaignForm>(key: K, value: CampaignForm[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const toggleContact = (id: string) => {
    update(
      "selectedContactIds",
      form.selectedContactIds.includes(id)
        ? form.selectedContactIds.filter((c) => c !== id)
        : [...form.selectedContactIds, id],
    );
  };

  const toggleTag = (id: string) => {
    update(
      "selectedTagIds",
      form.selectedTagIds.includes(id)
        ? form.selectedTagIds.filter((t) => t !== id)
        : [...form.selectedTagIds, id],
    );
  };

  const selectAll = () => {
    update("selectedContactIds", filteredContacts.map((c) => c.id));
  };

  const deselectAll = () => {
    update("selectedContactIds", []);
  };

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      update("templateId", templateId);
      update("messageContent", tpl.content);
      update("messageType", tpl.type);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = contactSearch.toLowerCase();
    return (
      !q ||
      (c.name?.toLowerCase().includes(q)) ||
      c.phone.includes(q)
    );
  });

  // Validation
  const canGoNext = (): boolean => {
    switch (step) {
      case "info":
        return form.name.trim().length > 0;
      case "recipients":
        return form.selectedContactIds.length > 0 || form.selectedTagIds.length > 0 || form.selectedFunnelStageIds.length > 0 || form.minScore > 0;
      case "message":
        return form.messageContent.trim().length > 0;
      case "schedule":
        return form.scheduleType === "now" || !!form.scheduledAt;
      default:
        return true;
    }
  };

  const goNext = () => {
    const idx = stepIndex;
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
  };

  const goPrev = () => {
    const idx = stepIndex;
    if (idx > 0) setStep(STEPS[idx - 1].key);
  };

  const totalRecipients = form.selectedContactIds.length;

  const handleCreate = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const campaignData = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        message_type: form.messageType,
        message_content: form.messageContent.trim(),
        media_url: form.mediaUrl.trim() || null,
        instance_id: form.instanceId || null,
        settings: {
          delayMin: form.delayMin,
          delayMax: form.delayMax,
          dailyLimit: form.dailyLimit,
          businessHoursOnly: form.businessHoursOnly,
          warmUpEnabled: form.warmUpEnabled,
          contentVariation: form.contentVariation,
          maxConsecutiveFailures: form.maxConsecutiveFailures,
          batchSize: 30,
          batchCooldownSec: 15,
          businessHourStart: 8,
          businessHourEnd: 20,
          timezoneOffset: -3,
          warmUpDayLimit: 50,
          ...(form.recurrenceEnabled ? { recurrence: { type: form.recurrenceType } } : {}),
          ...(form.interactive.type !== "none" ? { interactive: form.interactive } : {}),
        } as any,
      };

      if (isEditing && editCampaign) {
        const { error } = await supabase
          .from("campaigns")
          .update(campaignData as any)
          .eq("id", editCampaign.id);
        if (error) throw error;
        toast.success("Campanha atualizada!");
        onOpenChange(false);
        onCreated?.();
        return;
      }

      // New campaign flow
      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .insert({
          ...campaignData,
          status: form.scheduleType === "now" ? "draft" : "scheduled",
          scheduled_at: form.scheduledAt ? form.scheduledAt.toISOString() : null,
          created_by: user.id,
          stats: { total: totalRecipients, sent: 0, delivered: 0, read: 0, failed: 0 } as any,
        })
        .select("id")
        .single();

      if (campErr) throw campErr;

      // 2. Insert campaign contacts
      let allContactIds = new Set(form.selectedContactIds);

      if (form.selectedTagIds.length > 0) {
        const { data: tagContacts } = await supabase
          .from("contact_tags")
          .select("contact_id")
          .in("tag_id", form.selectedTagIds);
        tagContacts?.forEach((tc) => {
          if (tc.contact_id) allContactIds.add(tc.contact_id);
        });
      }

      // Add contacts from funnel stages
      if (form.selectedFunnelStageIds.length > 0) {
        const { data: funnelConvs } = await supabase
          .from("conversations")
          .select("contact_id")
          .in("funnel_stage_id", form.selectedFunnelStageIds);
        funnelConvs?.forEach((c) => {
          if (c.contact_id) allContactIds.add(c.contact_id);
        });
      }

      // Add contacts by minimum score (if no other filters, get all with that score)
      if (form.minScore > 0 && allContactIds.size === 0) {
        const { data: scored } = await supabase
          .from("conversations")
          .select("contact_id")
          .gte("score", form.minScore);
        scored?.forEach((s) => { if (s.contact_id) allContactIds.add(s.contact_id); });
      }

      // Filter by min score if set and we have contacts
      if (form.minScore > 0 && allContactIds.size > 0) {
        const { data: scored } = await supabase
          .from("conversations")
          .select("contact_id")
          .in("contact_id", Array.from(allContactIds))
          .gte("score", form.minScore);
        const scoredSet = new Set((scored || []).map((s) => s.contact_id));
        allContactIds = new Set([...allContactIds].filter((id) => scoredSet.has(id)));
      }

      const { data: contactPhones } = await supabase
        .from("contacts")
        .select("id, phone")
        .in("id", Array.from(allContactIds));

      if (contactPhones && contactPhones.length > 0) {
        const rows = contactPhones.map((c) => ({
          campaign_id: campaign!.id,
          contact_id: c.id,
          phone: c.phone,
          status: "pending",
        }));

        const { error: ccErr } = await supabase
          .from("campaign_contacts")
          .insert(rows);
        if (ccErr) throw ccErr;

        await supabase
          .from("campaigns")
          .update({ stats: { total: contactPhones.length, sent: 0, delivered: 0, read: 0, failed: 0 } as any })
          .eq("id", campaign!.id);
      }

      toast.success("Campanha criada com sucesso!");
      onOpenChange(false);
      onCreated?.();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[96vw] max-h-[98vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="font-heading text-xl">{isEditing ? "Editar Campanha" : "Nova Campanha"}</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 px-6 pb-4">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1 flex-1">
              <button
                onClick={() => i <= stepIndex && setStep(s.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  step === s.key
                    ? "bg-primary text-primary-foreground"
                    : i < stepIndex
                    ? "bg-primary/15 text-primary cursor-pointer"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {s.icon}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={cn("h-0.5 flex-1 rounded", i < stepIndex ? "bg-primary/30" : "bg-muted")} />
              )}
            </div>
          ))}
        </div>

        <Separator />

        {/* Content */}
        <ScrollArea className="flex-1 px-6 py-4 [&>[data-radix-scroll-area-viewport]]:!overflow-y-scroll" style={{ maxHeight: "80vh" }}>
          {step === "info" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome da Campanha *</Label>
                <Input
                  placeholder="Ex: Promoção de Verão"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  placeholder="Descreva o objetivo da campanha (opcional)"
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </div>
              <InstanceSelector
                value={form.instanceId}
                onChange={(v) => update("instanceId", v)}
                label="Enviar de qual instância?"
              />
            </div>
          )}

          {step === "recipients" && (
            <div className="space-y-4">
              {/* Segmentation Filters */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Filter className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold">Segmentação Avançada</p>
                </div>

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-primary" /> Filtrar por Tags
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant={form.selectedTagIds.includes(tag.id) ? "default" : "outline"}
                          className="cursor-pointer transition-colors"
                          style={
                            form.selectedTagIds.includes(tag.id)
                              ? { backgroundColor: tag.color, color: "#fff" }
                              : { borderColor: tag.color, color: tag.color }
                          }
                          onClick={() => toggleTag(tag.id)}
                        >
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Funnel Stages */}
                {funnelStages.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <GitBranch className="h-3 w-3 text-primary" /> Filtrar por Estágio do Funil
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {funnelStages.map((stage) => (
                        <Badge
                          key={stage.id}
                          variant={form.selectedFunnelStageIds.includes(stage.id) ? "default" : "outline"}
                          className="cursor-pointer transition-colors"
                          style={
                            form.selectedFunnelStageIds.includes(stage.id)
                              ? { backgroundColor: stage.color, color: "#fff" }
                              : { borderColor: stage.color, color: stage.color }
                          }
                          onClick={() => toggleFunnelStage(stage.id)}
                        >
                          <span className="text-[10px] opacity-70 mr-1">{stage.funnel_name} ›</span>
                          {stage.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Minimum Score */}
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1.5">
                    <TrendingUp className="h-3 w-3 text-primary" /> Score Mínimo
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      max={1000}
                      value={form.minScore}
                      onChange={(e) => update("minScore", Math.max(0, Number(e.target.value)))}
                      className="w-28 h-8 text-sm"
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">
                      {form.minScore > 0
                        ? `Apenas contatos com ≥ ${form.minScore} pontos`
                        : "Sem filtro de score"}
                    </p>
                  </div>
                </div>

                {/* Estimated Total */}
                <div className="rounded-md bg-background border border-border px-3 py-2 flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  {countLoading ? (
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Calculando...</span>
                    </div>
                  ) : (
                    <p className="text-sm font-medium">
                      {estimatedCount !== null ? (
                        <>
                          <span className="text-primary text-lg font-bold">{estimatedCount}</span>
                          {" "}contato(s) estimado(s)
                        </>
                      ) : (
                        <span className="text-muted-foreground">Selecione filtros ou contatos</span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Contacts */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Contatos Individuais</Label>
                  <div className="flex gap-2 text-xs">
                    <button onClick={selectAll} className="text-primary hover:underline">
                      Selecionar todos
                    </button>
                    <span className="text-muted-foreground">|</span>
                    <button onClick={deselectAll} className="text-primary hover:underline">
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome ou telefone..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="pl-9"
                  />
                  {contactSearch && (
                    <button
                      onClick={() => setContactSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <ScrollArea className="h-48 rounded-lg border border-border">
                  {loadingData ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato encontrado</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {filteredContacts.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                        >
                          <Checkbox
                            checked={form.selectedContactIds.includes(c.id)}
                            onCheckedChange={() => toggleContact(c.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{c.name || "Sem nome"}</p>
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <p className="text-xs text-muted-foreground">
                  {form.selectedContactIds.length} contato(s) selecionado(s)
                  {form.selectedTagIds.length > 0 && ` + ${form.selectedTagIds.length} tag(s)`}
                  {form.selectedFunnelStageIds.length > 0 && ` + ${form.selectedFunnelStageIds.length} estágio(s)`}
                  {form.minScore > 0 && ` (score ≥ ${form.minScore})`}
                </p>
              </div>
            </div>
          )}

          {step === "message" && (
            <div className="space-y-2">
              <Accordion type="multiple" defaultValue={["base", "interactive"]} className="space-y-3">
                {/* ─── MENSAGEM BASE ─── */}
                <AccordionItem value="base" className="rounded-lg border border-border bg-card px-4">
                  <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                    <span className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-primary/70" />
                      Mensagem base
                      {form.messageContent.trim() && (
                        <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                          {form.messageContent.length} chars
                        </Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pb-4">
                    {templates.length > 0 && (
                      <div className="space-y-2">
                        <Label>Usar Template</Label>
                        <Select
                          value={form.templateId || ""}
                          onValueChange={(v) => applyTemplate(v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um template (opcional)" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Tipo de Mensagem *</Label>
                      <Select
                        value={form.messageType}
                        onValueChange={(v) => update("messageType", v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {messageTypeOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <span className="flex items-center gap-2">
                                {opt.icon}
                                {opt.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Conteúdo da Mensagem *</Label>
                      <Textarea
                        placeholder="Digite sua mensagem... Use {{variavel}} para personalização"
                        value={form.messageContent}
                        onChange={(e) => update("messageContent", e.target.value)}
                        maxLength={4096}
                        rows={4}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        {form.messageContent.length}/4096 caracteres
                      </p>
                    </div>

                    {form.messageType !== "text" && (
                      <div className="space-y-2">
                        <Label>URL da Mídia</Label>
                        <Input
                          placeholder="https://exemplo.com/imagem.jpg"
                          value={form.mediaUrl}
                          onChange={(e) => update("mediaUrl", e.target.value)}
                        />
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* ─── MENSAGEM INTERATIVA ─── */}
                <AccordionItem value="interactive" className="rounded-lg border border-border bg-muted/20 px-4">
                  <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary/70" />
                      Mensagem interativa
                      {form.interactive.type !== "none" && (
                        <Badge variant="default" className="ml-1 text-[10px] px-1.5 py-0">
                          {form.interactive.type}
                        </Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <InteractiveMessageBuilder
                      value={form.interactive}
                      onChange={(v) => update("interactive", v)}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}

          {step === "preview" && (
            <CampaignMessagePreview
              messageType={form.messageType}
              messageContent={form.messageContent}
              mediaUrl={form.mediaUrl || undefined}
              interactive={form.interactive}
            />
          )}

          {step === "schedule" && (
            <div className="space-y-6">
              <div className="space-y-4">
                <Label>Quando enviar?</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      update("scheduleType", "now");
                      update("scheduledAt", undefined);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border-2 p-6 transition-colors",
                      form.scheduleType === "now"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <Clock className="h-8 w-8 text-primary" />
                    <span className="font-medium">Enviar Agora</span>
                    <span className="text-xs text-muted-foreground">
                      A campanha será iniciada imediatamente
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => update("scheduleType", "scheduled")}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border-2 p-6 transition-colors",
                      form.scheduleType === "scheduled"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <CalendarIcon className="h-8 w-8 text-primary" />
                    <span className="font-medium">Agendar</span>
                    <span className="text-xs text-muted-foreground">
                      Escolha data e hora para envio
                    </span>
                  </button>
                </div>

                {form.scheduleType === "scheduled" && (
                  <div className="space-y-2">
                    <Label>Data e Hora</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !form.scheduledAt && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {form.scheduledAt
                            ? format(form.scheduledAt, "PPP 'às' HH:mm", { locale: ptBR })
                            : "Selecione a data"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.scheduledAt}
                          onSelect={(d) => {
                            if (d) {
                              const existing = form.scheduledAt;
                              if (existing) {
                                d.setHours(existing.getHours(), existing.getMinutes());
                              } else {
                                d.setHours(9, 0);
                              }
                              update("scheduledAt", d);
                            }
                          }}
                          disabled={(date) => date < new Date()}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                        {form.scheduledAt && (
                          <div className="border-t px-4 py-3">
                            <Label className="text-xs">Horário</Label>
                            <Input
                              type="time"
                              value={form.scheduledAt ? format(form.scheduledAt, "HH:mm") : "09:00"}
                              onChange={(e) => {
                                const [h, m] = e.target.value.split(":").map(Number);
                                const newDate = new Date(form.scheduledAt!);
                                newDate.setHours(h, m);
                                update("scheduledAt", newDate);
                              }}
                              className="mt-1"
                            />
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                {form.scheduleType === "scheduled" && (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">🔄 Campanha Recorrente</p>
                        <p className="text-xs text-muted-foreground">Repetir automaticamente esta campanha</p>
                      </div>
                      <Switch checked={form.recurrenceEnabled} onCheckedChange={(v) => update("recurrenceEnabled", v)} />
                    </div>
                    {form.recurrenceEnabled && (
                      <div className="space-y-2">
                        <Label className="text-xs">Frequência</Label>
                        <Select value={form.recurrenceType} onValueChange={(v) => update("recurrenceType", v as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Diária</SelectItem>
                            <SelectItem value="weekly">Semanal</SelectItem>
                            <SelectItem value="monthly">Mensal</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {form.recurrenceType === "daily" && "A campanha será executada todos os dias no horário agendado."}
                          {form.recurrenceType === "weekly" && "A campanha será executada toda semana no mesmo dia e horário."}
                          {form.recurrenceType === "monthly" && "A campanha será executada todo mês no mesmo dia e horário."}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Anti-block settings */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Proteção Anti-Bloqueio (Meta)</p>
                    <p className="text-xs text-muted-foreground">Configurações baseadas nas boas práticas da Meta para WhatsApp</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                  {/* Business Hours */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Horário comercial apenas</p>
                      <p className="text-xs text-muted-foreground">Enviar apenas entre 8h e 20h (BRT)</p>
                    </div>
                    <Switch checked={form.businessHoursOnly} onCheckedChange={(v) => update("businessHoursOnly", v)} />
                  </div>

                  <Separator />

                  {/* Warm-up Mode */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Modo warm-up</p>
                      <p className="text-xs text-muted-foreground">Limite inicial de 50/dia para números novos</p>
                    </div>
                    <Switch checked={form.warmUpEnabled} onCheckedChange={(v) => update("warmUpEnabled", v)} />
                  </div>

                  <Separator />

                  {/* Content Variation */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Variação de conteúdo</p>
                      <p className="text-xs text-muted-foreground">Pequenas variações invisíveis para evitar detecção de duplicatas</p>
                    </div>
                    <Switch checked={form.contentVariation} onCheckedChange={(v) => update("contentVariation", v)} />
                  </div>

                  <Separator />

                  {/* Delay Range */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Intervalo entre mensagens</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Mínimo (seg)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={form.delayMin / 1000}
                          onChange={(e) => update("delayMin", Math.max(1000, Number(e.target.value) * 1000))}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Máximo (seg)</Label>
                        <Input
                          type="number"
                          min={2}
                          max={60}
                          value={form.delayMax / 1000}
                          onChange={(e) => update("delayMax", Math.max(2000, Number(e.target.value) * 1000))}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Delay aleatório entre cada envio (recomendado: 3-8s)</p>
                  </div>

                  <Separator />

                  {/* Daily Limit */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Limite diário</p>
                    <Input
                      type="number"
                      min={10}
                      max={1000}
                      value={form.dailyLimit}
                      onChange={(e) => update("dailyLimit", Math.max(10, Number(e.target.value)))}
                    />
                    <p className="text-xs text-muted-foreground">Máximo de mensagens por dia (recomendado: 200)</p>
                  </div>

                  <Separator />

                  {/* Max Consecutive Failures */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Auto-pausar após falhas</p>
                    <Input
                      type="number"
                      min={2}
                      max={20}
                      value={form.maxConsecutiveFailures}
                      onChange={(e) => update("maxConsecutiveFailures", Math.max(2, Number(e.target.value)))}
                    />
                    <p className="text-xs text-muted-foreground">Pausar campanha após N falhas consecutivas (protege seu número)</p>
                  </div>
                </div>

                {/* Info box */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex gap-2">
                  <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong className="text-foreground">Boas práticas Meta/WhatsApp:</strong></p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>Envie apenas para contatos que optaram por receber mensagens</li>
                      <li>Evite envios fora do horário comercial</li>
                      <li>Comece com volumes baixos e aumente gradualmente</li>
                      <li>Monitore a taxa de falhas — se subir, pause e investigue</li>
                      <li>Não envie a mesma mensagem para todos — personalize com variáveis</li>
                      <li>Mantenha uma taxa de resposta saudável — mensagens ignoradas prejudicam</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Nome</p>
                  <p className="font-medium">{form.name}</p>
                  {form.description && (
                    <p className="text-sm text-muted-foreground mt-1">{form.description}</p>
                  )}
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Destinatários</p>
                  <p className="font-medium">
                    {form.selectedContactIds.length} contato(s)
                    {form.selectedTagIds.length > 0 && ` + ${form.selectedTagIds.length} tag(s)`}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Tipo</p>
                  <p className="font-medium capitalize">{form.messageType}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Mensagem</p>
                  <p className="text-sm whitespace-pre-wrap mt-1 line-clamp-4">{form.messageContent}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Envio</p>
                  <p className="font-medium">
                    {form.scheduleType === "now"
                      ? "Imediato"
                      : form.scheduledAt
                      ? format(form.scheduledAt, "dd/MM/yyyy 'às' HH:mm")
                      : "Agendado (sem data)"}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">Proteção Anti-Bloqueio</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {form.businessHoursOnly && <Badge variant="outline" className="text-xs">Horário comercial</Badge>}
                    {form.warmUpEnabled && <Badge variant="outline" className="text-xs">Warm-up</Badge>}
                    {form.contentVariation && <Badge variant="outline" className="text-xs">Variação de conteúdo</Badge>}
                    <Badge variant="outline" className="text-xs">Delay: {form.delayMin/1000}-{form.delayMax/1000}s</Badge>
                    <Badge variant="outline" className="text-xs">Limite: {form.dailyLimit}/dia</Badge>
                  </div>
                </div>
              </div>
            </div>
          )}
        </ScrollArea>

        <Separator />

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4">
          <Button
            variant="ghost"
            onClick={stepIndex === 0 ? () => onOpenChange(false) : goPrev}
          >
            {stepIndex === 0 ? (
              "Cancelar"
            ) : (
              <>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Voltar
              </>
            )}
          </Button>

          {step === "review" ? (
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {isEditing ? "Salvar Alterações" : form.scheduleType === "now" ? "Criar Campanha" : "Agendar Campanha"}
            </Button>
          ) : (
            <Button onClick={goNext} disabled={!canGoNext()}>
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
