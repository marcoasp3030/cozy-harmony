import { useState, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import FlowNode from "./FlowNode";
import NodePalette from "./NodePalette";
import NodeConfigPanel from "./NodeConfigPanel";
import { getNodeTypeConfig } from "./nodeTypes";

const customNodeTypes = { flowNode: FlowNode };

const defaultEdgeOptions = {
  animated: true,
  style: { strokeWidth: 2, stroke: "hsl(var(--primary))" },
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
};

interface FlowBuilderProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onSave: (nodes: Node[], edges: Edge[]) => void;
}

const FlowBuilder = ({ initialNodes = [], initialEdges = [], onSave }: FlowBuilderProps) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/reactflow");
      if (!nodeType || !reactFlowInstance || !reactFlowWrapper.current) return;

      const config = getNodeTypeConfig(nodeType);
      if (!config) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: Node = {
        id: `${nodeType}_${Date.now()}`,
        type: "flowNode",
        position,
        data: {
          nodeType,
          ...Object.fromEntries(config.fields.map((f) => [f.key, f.defaultValue ?? ""])),
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const updateNodeData = useCallback(
    (id: string, data: Record<string, any>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data } : n))
      );
      setSelectedNode((prev) => (prev?.id === id ? { ...prev, data } : prev));
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  // Auto-save effect: expose current state for parent
  const handleSave = useCallback(() => {
    onSave(nodes, edges);
  }, [nodes, edges, onSave]);

  return (
    <div className="flex h-full border rounded-lg overflow-hidden bg-background">
      <NodePalette />

      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={customNodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          className="bg-muted/20"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-30" />
          <Controls className="!bg-card !border !shadow-md" />
          <MiniMap
            className="!bg-card !border !shadow-md"
            nodeColor={(n) => {
              const cfg = getNodeTypeConfig(n.data?.nodeType as string);
              return cfg?.color || "#888";
            }}
            maskColor="hsl(var(--background) / 0.7)"
          />
        </ReactFlow>

        {/* Save button floating */}
        <button
          onClick={handleSave}
          className="absolute top-3 right-3 z-10 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        >
          Salvar Fluxo
        </button>
      </div>

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onUpdate={updateNodeData}
          onClose={() => setSelectedNode(null)}
          onDelete={deleteNode}
        />
      )}
    </div>
  );
};

export default FlowBuilder;
