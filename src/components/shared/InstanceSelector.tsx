import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Smartphone } from "lucide-react";
import { useWhatsAppInstances, type WhatsAppInstance } from "@/hooks/useWhatsAppInstances";

interface InstanceSelectorProps {
  value: string | null;
  onChange: (instanceId: string) => void;
  label?: string;
  className?: string;
}

export default function InstanceSelector({ value, onChange, label, className }: InstanceSelectorProps) {
  const { instances, loading } = useWhatsAppInstances();

  if (loading || instances.length === 0) return null;

  return (
    <div className={className}>
      {label && <p className="text-sm font-medium mb-1.5">{label}</p>}
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder="Instância padrão" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {instances.map((inst) => (
            <SelectItem key={inst.id} value={inst.id}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${inst.status === "connected" ? "bg-emerald-500" : "bg-destructive"}`} />
                {inst.name}
                {inst.is_default && <span className="text-[10px] text-muted-foreground">(padrão)</span>}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
