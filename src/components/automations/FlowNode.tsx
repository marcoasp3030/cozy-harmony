import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";
import { GripVertical } from "lucide-react";

const FlowNode = memo(({ data, selected }: NodeProps) => {
  const config = getNodeTypeConfig(data.nodeType as string);
  if (!config) return null;

  const Icon = config.icon;
  const isTrigger = config.category === "trigger";
  const isCondition = config.category === "condition";

  return (
    <div
      className={`relative rounded-xl border-2 bg-card shadow-lg transition-all min-w-[200px] max-w-[260px] ${
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
      style={{ borderColor: config.color + "80" }}
    >
      {/* Target handle (top) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !border-2 !border-background !-top-1.5"
          style={{ backgroundColor: config.color }}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-[10px] px-3 py-2"
        style={{ backgroundColor: config.color + "18" }}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab" />
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ backgroundColor: config.color + "30" }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
        </div>
        <span className="text-xs font-semibold truncate" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>

      {/* Body - show configured values */}
      <div className="px-3 py-2 space-y-1">
        {config.fields.slice(0, 2).map((field) => {
          const val = (data as Record<string, any>)[field.key];
          if (!val) return null;
          return (
            <div key={field.key} className="text-[10px] text-muted-foreground truncate">
              <span className="font-medium">{field.label}:</span>{" "}
              <span className="text-foreground/80">{String(val).slice(0, 40)}</span>
            </div>
          );
        })}
        {config.fields.length > 0 && !config.fields.some((f) => (data as Record<string, any>)[f.key]) && (
          <p className="text-[10px] text-muted-foreground/60 italic">Clique para configurar</p>
        )}
      </div>

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !border-2 !border-background !-bottom-1.5"
        style={{ backgroundColor: config.color }}
      />

      {/* Condition: extra handles for yes/no */}
      {isCondition && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="yes"
            className="!w-2.5 !h-2.5 !border-2 !border-background !-right-1"
            style={{ backgroundColor: "#22c55e", top: "60%" }}
          />
          <Handle
            type="source"
            position={Position.Left}
            id="no"
            className="!w-2.5 !h-2.5 !border-2 !border-background !-left-1"
            style={{ backgroundColor: "#ef4444", top: "60%" }}
          />
          <div className="absolute -right-6 text-[8px] font-bold text-green-500" style={{ top: "56%" }}>Sim</div>
          <div className="absolute -left-7 text-[8px] font-bold text-red-500" style={{ top: "56%" }}>Não</div>
        </>
      )}
    </div>
  );
});

FlowNode.displayName = "FlowNode";
export default FlowNode;
