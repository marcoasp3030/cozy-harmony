import { NODE_TYPES, getCategoryLabel, type NodeCategory } from "./nodeTypes";
import { ScrollArea } from "@/components/ui/scroll-area";

const categories: NodeCategory[] = ["trigger", "condition", "action"];

const NodePalette = () => {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-56 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Componentes
        </h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-4">
          {categories.map((cat) => {
            const nodes = NODE_TYPES.filter((n) => n.category === cat);
            return (
              <div key={cat}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                  {getCategoryLabel(cat)}
                </p>
                <div className="space-y-1">
                  {nodes.map((node) => {
                    const Icon = node.icon;
                    return (
                      <div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e, node.type)}
                        className="flex items-center gap-2 rounded-lg border bg-card p-2 cursor-grab hover:shadow-md hover:border-primary/30 transition-all active:cursor-grabbing"
                        title={node.description}
                      >
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                          style={{ backgroundColor: node.color + "20" }}
                        >
                          <Icon className="h-3.5 w-3.5" style={{ color: node.color }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium leading-tight truncate">{node.label}</p>
                          <p className="text-[9px] text-muted-foreground leading-tight truncate">
                            {node.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default NodePalette;
