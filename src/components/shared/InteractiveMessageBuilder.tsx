import { useState } from "react";
import { Plus, Trash2, Link, Phone, ListOrdered, MousePointerClick, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type InteractiveType = "none" | "buttons" | "list" | "cta" | "poll";

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface CtaButton {
  id: string;
  type: "url" | "phone";
  title: string;
  value: string;
}

export interface PollOption {
  id: string;
  title: string;
}

export interface InteractiveMessage {
  type: InteractiveType;
  body: string;
  footer?: string;
  header?: string;
  buttons?: ReplyButton[];
  listSections?: ListSection[];
  listButtonText?: string;
  ctaButtons?: CtaButton[];
  pollName?: string;
  pollOptions?: PollOption[];
  pollMultiSelect?: boolean;
}

const defaultInteractive: InteractiveMessage = {
  type: "none",
  body: "",
  footer: "",
  header: "",
  buttons: [],
  listSections: [{ title: "Opções", rows: [{ id: "1", title: "" }] }],
  listButtonText: "Ver opções",
  ctaButtons: [],
  pollName: "",
  pollOptions: [{ id: "1", title: "" }, { id: "2", title: "" }],
  pollMultiSelect: false,
};

const genId = () => Math.random().toString(36).slice(2, 8);

interface Props {
  value: InteractiveMessage;
  onChange: (v: InteractiveMessage) => void;
  compact?: boolean;
}

export function getDefaultInteractive(): InteractiveMessage {
  return { ...defaultInteractive, buttons: [], listSections: [{ title: "Opções", rows: [{ id: genId(), title: "" }] }], ctaButtons: [], pollOptions: [{ id: genId(), title: "" }, { id: genId(), title: "" }] };
}

export default function InteractiveMessageBuilder({ value, onChange, compact }: Props) {
  const update = <K extends keyof InteractiveMessage>(key: K, val: InteractiveMessage[K]) =>
    onChange({ ...value, [key]: val });

  const typeOptions: { value: InteractiveType; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
    { value: "none", label: "Nenhuma", icon: null, desc: "Texto simples", color: "text-muted-foreground" },
    { value: "buttons", label: "Botões", icon: <MousePointerClick className="h-5 w-5" />, desc: "Até 3 respostas rápidas", color: "text-blue-500" },
    { value: "list", label: "Lista", icon: <ListOrdered className="h-5 w-5" />, desc: "Menu com seções", color: "text-emerald-500" },
    { value: "cta", label: "CTA", icon: <Link className="h-5 w-5" />, desc: "Link ou telefone", color: "text-orange-500" },
    { value: "poll", label: "Enquete", icon: <BarChart3 className="h-5 w-5" />, desc: "Votação", color: "text-violet-500" },
  ];

  // ─── BUTTONS ───
  const addButton = () => {
    if ((value.buttons?.length || 0) >= 3) return;
    update("buttons", [...(value.buttons || []), { id: genId(), title: "" }]);
  };
  const removeButton = (id: string) => update("buttons", (value.buttons || []).filter((b) => b.id !== id));
  const updateButton = (id: string, title: string) =>
    update("buttons", (value.buttons || []).map((b) => (b.id === id ? { ...b, title } : b)));

  // ─── LIST ───
  const addRow = (sIdx: number) => {
    const sections = [...(value.listSections || [])];
    if (sections[sIdx].rows.length >= 10) return;
    sections[sIdx] = { ...sections[sIdx], rows: [...sections[sIdx].rows, { id: genId(), title: "" }] };
    update("listSections", sections);
  };
  const removeRow = (sIdx: number, rowId: string) => {
    const sections = [...(value.listSections || [])];
    sections[sIdx] = { ...sections[sIdx], rows: sections[sIdx].rows.filter((r) => r.id !== rowId) };
    update("listSections", sections);
  };
  const updateRow = (sIdx: number, rowId: string, field: "title" | "description", val: string) => {
    const sections = [...(value.listSections || [])];
    sections[sIdx] = {
      ...sections[sIdx],
      rows: sections[sIdx].rows.map((r) => (r.id === rowId ? { ...r, [field]: val } : r)),
    };
    update("listSections", sections);
  };
  const addSection = () => {
    if ((value.listSections?.length || 0) >= 5) return;
    update("listSections", [...(value.listSections || []), { title: "", rows: [{ id: genId(), title: "" }] }]);
  };
  const removeSection = (sIdx: number) => {
    update("listSections", (value.listSections || []).filter((_, i) => i !== sIdx));
  };
  const updateSectionTitle = (sIdx: number, title: string) => {
    const sections = [...(value.listSections || [])];
    sections[sIdx] = { ...sections[sIdx], title };
    update("listSections", sections);
  };

  // ─── CTA ───
  const addCta = () => {
    if ((value.ctaButtons?.length || 0) >= 3) return;
    update("ctaButtons", [...(value.ctaButtons || []), { id: genId(), type: "url", title: "", value: "" }]);
  };
  const removeCta = (id: string) => update("ctaButtons", (value.ctaButtons || []).filter((b) => b.id !== id));
  const updateCta = (id: string, field: keyof CtaButton, val: string) =>
    update("ctaButtons", (value.ctaButtons || []).map((b) => (b.id === id ? { ...b, [field]: val } : b)));

  // ─── POLL ───
  const addPollOption = () => {
    if ((value.pollOptions?.length || 0) >= 12) return;
    update("pollOptions", [...(value.pollOptions || []), { id: genId(), title: "" }]);
  };
  const removePollOption = (id: string) => update("pollOptions", (value.pollOptions || []).filter((o) => o.id !== id));
  const updatePollOption = (id: string, title: string) =>
    update("pollOptions", (value.pollOptions || []).map((o) => (o.id === id ? { ...o, title } : o)));

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Mensagem Interativa</Label>
        <p className="text-xs text-muted-foreground">Adicione botões, listas ou enquetes à sua mensagem</p>
        <div className="flex flex-wrap gap-2">
          {typeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const newVal = { ...value, type: opt.value };
                if (opt.value === "buttons" && (!newVal.buttons || newVal.buttons.length === 0))
                  newVal.buttons = [{ id: genId(), title: "" }];
                if (opt.value === "cta" && (!newVal.ctaButtons || newVal.ctaButtons.length === 0))
                  newVal.ctaButtons = [{ id: genId(), type: "url", title: "", value: "" }];
                if (opt.value === "poll" && (!newVal.pollOptions || newVal.pollOptions.length < 2))
                  newVal.pollOptions = [{ id: genId(), title: "" }, { id: genId(), title: "" }];
                onChange(newVal);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-xs transition-all",
                value.type === opt.value
                  ? "border-primary bg-primary/5 text-primary shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-muted/50",
              )}
            >
              {opt.icon && <span className={cn(opt.color)}>{opt.icon}</span>}
              <div className="text-left">
                <span className="font-medium">{opt.label}</span>
                {!compact && <p className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {value.type !== "none" && (
        <>
          <Separator />

          {/* Header (optional) */}
          <div className="space-y-1">
            <Label className="text-xs">Cabeçalho (opcional)</Label>
            <Input
              placeholder="Título da mensagem"
              value={value.header || ""}
              onChange={(e) => update("header", e.target.value)}
              maxLength={60}
            />
          </div>

          {/* Body */}
          <div className="space-y-1">
            <Label className="text-xs">Corpo da mensagem *</Label>
            <Textarea
              placeholder="Texto principal da mensagem interativa..."
              value={value.body}
              onChange={(e) => update("body", e.target.value)}
              maxLength={1024}
              rows={3}
            />
          </div>

          {/* Footer (optional) */}
          <div className="space-y-1">
            <Label className="text-xs">Rodapé (opcional)</Label>
            <Input
              placeholder="Texto do rodapé"
              value={value.footer || ""}
              onChange={(e) => update("footer", e.target.value)}
              maxLength={60}
            />
          </div>

          <Separator />

          {/* ─── BUTTONS EDITOR ─── */}
          {value.type === "buttons" && (
            <div className="space-y-3">
              <Label>Botões de resposta rápida (máx. 3)</Label>
              {(value.buttons || []).map((btn, i) => (
                <div key={btn.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0 w-6 h-6 flex items-center justify-center p-0 text-xs">
                    {i + 1}
                  </Badge>
                  <Input
                    placeholder={`Botão ${i + 1}`}
                    value={btn.title}
                    onChange={(e) => updateButton(btn.id, e.target.value)}
                    maxLength={20}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => removeButton(btn.id)}
                    disabled={(value.buttons?.length || 0) <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(value.buttons?.length || 0) < 3 && (
                <Button variant="outline" size="sm" onClick={addButton} className="gap-1">
                  <Plus className="h-3 w-3" /> Adicionar botão
                </Button>
              )}
            </div>
          )}

          {/* ─── LIST EDITOR ─── */}
          {value.type === "list" && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">Texto do botão da lista</Label>
                <Input
                  placeholder="Ver opções"
                  value={value.listButtonText || ""}
                  onChange={(e) => update("listButtonText", e.target.value)}
                  maxLength={20}
                />
              </div>

              {(value.listSections || []).map((section, sIdx) => (
                <div key={sIdx} className="rounded-lg border border-border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={`Seção ${sIdx + 1}`}
                      value={section.title}
                      onChange={(e) => updateSectionTitle(sIdx, e.target.value)}
                      maxLength={24}
                      className="flex-1 font-medium"
                    />
                    {(value.listSections?.length || 0) > 1 && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeSection(sIdx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  {section.rows.map((row, rIdx) => (
                    <div key={row.id} className="pl-4 flex gap-2">
                      <div className="flex-1 space-y-1">
                        <Input
                          placeholder={`Item ${rIdx + 1}`}
                          value={row.title}
                          onChange={(e) => updateRow(sIdx, row.id, "title", e.target.value)}
                          maxLength={24}
                        />
                        <Input
                          placeholder="Descrição (opcional)"
                          value={row.description || ""}
                          onChange={(e) => updateRow(sIdx, row.id, "description", e.target.value)}
                          maxLength={72}
                          className="text-xs"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive shrink-0 self-center"
                        onClick={() => removeRow(sIdx, row.id)}
                        disabled={section.rows.length <= 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  {section.rows.length < 10 && (
                    <Button variant="ghost" size="sm" onClick={() => addRow(sIdx)} className="gap-1 ml-4 text-xs">
                      <Plus className="h-3 w-3" /> Item
                    </Button>
                  )}
                </div>
              ))}

              {(value.listSections?.length || 0) < 5 && (
                <Button variant="outline" size="sm" onClick={addSection} className="gap-1">
                  <Plus className="h-3 w-3" /> Adicionar seção
                </Button>
              )}
            </div>
          )}

          {/* ─── CTA BUTTONS EDITOR ─── */}
          {value.type === "cta" && (
            <div className="space-y-3">
              <Label>Botões de ação (máx. 3)</Label>
              {(value.ctaButtons || []).map((btn, i) => (
                <div key={btn.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Select value={btn.type} onValueChange={(v) => updateCta(btn.id, "type", v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="url">
                          <span className="flex items-center gap-1"><Link className="h-3 w-3" /> URL</span>
                        </SelectItem>
                        <SelectItem value="phone">
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> Telefone</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Texto do botão"
                      value={btn.title}
                      onChange={(e) => updateCta(btn.id, "title", e.target.value)}
                      maxLength={20}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive shrink-0"
                      onClick={() => removeCta(btn.id)}
                      disabled={(value.ctaButtons?.length || 0) <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Input
                    placeholder={btn.type === "url" ? "https://exemplo.com" : "+5511999999999"}
                    value={btn.value}
                    onChange={(e) => updateCta(btn.id, "value", e.target.value)}
                  />
                </div>
              ))}
              {(value.ctaButtons?.length || 0) < 3 && (
                <Button variant="outline" size="sm" onClick={addCta} className="gap-1">
                  <Plus className="h-3 w-3" /> Adicionar botão
                </Button>
              )}
            </div>
          )}

          {/* ─── POLL EDITOR ─── */}
          {value.type === "poll" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome da enquete *</Label>
                <Input
                  placeholder="Qual sua preferência?"
                  value={value.pollName || ""}
                  onChange={(e) => update("pollName", e.target.value)}
                  maxLength={256}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="poll-multi"
                  checked={value.pollMultiSelect || false}
                  onChange={(e) => update("pollMultiSelect", e.target.checked)}
                  className="rounded border-border"
                />
                <Label htmlFor="poll-multi" className="text-xs cursor-pointer">Permitir múltiplas respostas</Label>
              </div>
              <Label>Opções (mín. 2, máx. 12)</Label>
              {(value.pollOptions || []).map((opt, i) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0 w-6 h-6 flex items-center justify-center p-0 text-xs">
                    {i + 1}
                  </Badge>
                  <Input
                    placeholder={`Opção ${i + 1}`}
                    value={opt.title}
                    onChange={(e) => updatePollOption(opt.id, e.target.value)}
                    maxLength={100}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => removePollOption(opt.id)}
                    disabled={(value.pollOptions?.length || 0) <= 2}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(value.pollOptions?.length || 0) < 12 && (
                <Button variant="outline" size="sm" onClick={addPollOption} className="gap-1">
                  <Plus className="h-3 w-3" /> Adicionar opção
                </Button>
              )}
            </div>
          )}

          {/* ─── PREVIEW ─── */}
          <Separator />
          <div className="space-y-2">
            <Label className="text-xs">Pré-visualização</Label>
            <div className="rounded-lg bg-muted p-4">
              <div className="inline-block max-w-[85%] rounded-xl bg-success/15 overflow-hidden">
                {value.header && (
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-sm font-bold">{value.header}</p>
                  </div>
                )}
                <div className="px-4 py-2">
                  <p className="text-sm whitespace-pre-wrap">{value.body || "..."}</p>
                </div>
                {value.footer && (
                  <div className="px-4 pb-2">
                    <p className="text-[11px] text-muted-foreground">{value.footer}</p>
                  </div>
                )}

                {value.type === "buttons" && (value.buttons || []).length > 0 && (
                  <div className="border-t border-border/30">
                    {(value.buttons || []).map((btn) => (
                      <div
                        key={btn.id}
                        className="text-center py-2 text-sm text-primary font-medium border-b border-border/20 last:border-0"
                      >
                        {btn.title || "..."}
                      </div>
                    ))}
                  </div>
                )}

                {value.type === "list" && (
                  <div className="border-t border-border/30">
                    <div className="text-center py-2 text-sm text-primary font-medium flex items-center justify-center gap-1">
                      <ListOrdered className="h-3.5 w-3.5" />
                      {value.listButtonText || "Ver opções"}
                    </div>
                  </div>
                )}

                {value.type === "cta" && (value.ctaButtons || []).length > 0 && (
                  <div className="border-t border-border/30">
                    {(value.ctaButtons || []).map((btn) => (
                      <div
                        key={btn.id}
                        className="text-center py-2 text-sm text-primary font-medium border-b border-border/20 last:border-0 flex items-center justify-center gap-1"
                      >
                        {btn.type === "url" ? <Link className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                        {btn.title || "..."}
                      </div>
                    ))}
                  </div>
                )}

                {value.type === "poll" && (value.pollOptions || []).length > 0 && (
                  <div className="border-t border-border/30">
                    <div className="px-4 py-2">
                      <p className="text-xs font-bold flex items-center gap-1"><BarChart3 className="h-3 w-3" /> {value.pollName || "Enquete"}</p>
                      {value.pollMultiSelect && <p className="text-[10px] text-muted-foreground">Múltipla escolha</p>}
                    </div>
                    {(value.pollOptions || []).map((opt) => (
                      <div
                        key={opt.id}
                        className="px-4 py-1.5 text-xs border-t border-border/20 flex items-center gap-2"
                      >
                        <span className="h-3 w-3 rounded-full border border-primary/50 shrink-0" />
                        {opt.title || "..."}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
