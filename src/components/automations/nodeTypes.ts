import {
  MessageSquare, Search, Clock, UserPlus, Tag, ArrowRight,
  Send, Bot, Globe, Zap, Volume2, BarChart3, GitBranch,
  Variable, Timer, Mail, Phone, Filter, Users, Building2,
  FileType, Layers, AudioLines, FileText
} from "lucide-react";

export type NodeCategory = "trigger" | "condition" | "action";

export interface NodeTypeConfig {
  type: string;
  label: string;
  category: NodeCategory;
  icon: any;
  color: string;
  description: string;
  fields: NodeField[];
}

export interface NodeField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "switch" | "tags";
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: any;
  required?: boolean;
}

export const NODE_TYPES: NodeTypeConfig[] = [
  // ── Triggers ───────────────────────────────────────────
  {
    type: "trigger_message",
    label: "Mensagem Recebida",
    category: "trigger",
    icon: MessageSquare,
    color: "#22c55e",
    description: "Inicia quando qualquer mensagem é recebida",
    fields: [],
  },
  {
    type: "trigger_keyword",
    label: "Palavra-chave",
    category: "trigger",
    icon: Search,
    color: "#22c55e",
    description: "Inicia quando uma palavra-chave é detectada",
    fields: [
      { key: "keywords", label: "Palavras-chave (separadas por vírgula)", type: "text", placeholder: "oi, olá, bom dia", required: true },
      { key: "match_type", label: "Tipo de correspondência", type: "select", options: [{ value: "contains", label: "Contém" }, { value: "exact", label: "Exata" }, { value: "starts_with", label: "Começa com" }], defaultValue: "contains" },
    ],
  },
  {
    type: "trigger_first_contact",
    label: "Primeiro Contato",
    category: "trigger",
    icon: UserPlus,
    color: "#22c55e",
    description: "Inicia quando um contato novo envia a primeira mensagem",
    fields: [],
  },
  {
    type: "trigger_schedule",
    label: "Agendamento",
    category: "trigger",
    icon: Clock,
    color: "#22c55e",
    description: "Inicia em horário programado (cron)",
    fields: [
      { key: "cron", label: "Expressão Cron", type: "text", placeholder: "0 9 * * 1-5", required: true },
      { key: "timezone", label: "Fuso horário", type: "text", placeholder: "America/Sao_Paulo", defaultValue: "America/Sao_Paulo" },
    ],
  },

  // ── Conditions ─────────────────────────────────────────
  {
    type: "condition_contains",
    label: "Contém Texto",
    category: "condition",
    icon: Filter,
    color: "#f59e0b",
    description: "Verifica se a mensagem contém texto específico",
    fields: [
      { key: "text", label: "Texto para buscar", type: "text", placeholder: "preço, valor, custo", required: true },
      { key: "case_sensitive", label: "Diferencia maiúsculas", type: "switch", defaultValue: false },
    ],
  },
  {
    type: "condition_tag",
    label: "Tem Tag",
    category: "condition",
    icon: Tag,
    color: "#f59e0b",
    description: "Verifica se o contato possui determinada tag",
    fields: [
      { key: "tag_name", label: "Nome da Tag", type: "text", placeholder: "vip, lead", required: true },
    ],
  },
  {
    type: "condition_time",
    label: "Horário",
    category: "condition",
    icon: Clock,
    color: "#f59e0b",
    description: "Verifica se está dentro do horário de funcionamento",
    fields: [
      { key: "start_time", label: "Hora início", type: "text", placeholder: "08:00" },
      { key: "end_time", label: "Hora fim", type: "text", placeholder: "18:00" },
      { key: "days", label: "Dias (1=Seg, 7=Dom)", type: "text", placeholder: "1,2,3,4,5" },
    ],
  },
  {
    type: "condition_business_hours",
    label: "Verificar Expediente",
    category: "condition",
    icon: Building2,
    color: "#f59e0b",
    description: "Verifica se está dentro do horário de expediente configurado nas Configurações",
    fields: [
      { key: "use_saved_config", label: "Usar horários salvos nas configurações", type: "switch", defaultValue: true },
      { key: "out_of_hours_message", label: "Mensagem fora do expediente (opcional, sobrescreve a padrão)", type: "textarea", placeholder: "Deixe vazio para usar a mensagem padrão das configurações" },
    ],
  },
  {
    type: "condition_contact_field",
    label: "Campo do Contato",
    category: "condition",
    icon: Users,
    color: "#f59e0b",
    description: "Verifica um campo do contato (nome, email, etc.)",
    fields: [
      { key: "field", label: "Campo", type: "select", options: [{ value: "name", label: "Nome" }, { value: "email", label: "Email" }, { value: "phone", label: "Telefone" }, { value: "about", label: "Sobre" }] },
      { key: "operator", label: "Operador", type: "select", options: [{ value: "exists", label: "Existe" }, { value: "not_exists", label: "Não existe" }, { value: "contains", label: "Contém" }, { value: "equals", label: "Igual a" }] },
      { key: "value", label: "Valor", type: "text", placeholder: "Valor para comparar" },
    ],
  },

  // ── Actions ────────────────────────────────────────────
  {
    type: "action_send_message",
    label: "Enviar Mensagem",
    category: "action",
    icon: Send,
    color: "#3b82f6",
    description: "Envia uma mensagem de texto ao contato",
    fields: [
      { key: "message", label: "Mensagem", type: "textarea", placeholder: "Olá {{nome}}, tudo bem?", required: true },
    ],
  },
  {
    type: "action_send_template",
    label: "Enviar Template",
    category: "action",
    icon: Mail,
    color: "#3b82f6",
    description: "Envia um template salvo",
    fields: [
      { key: "template_name", label: "Nome do Template", type: "text", placeholder: "boas_vindas", required: true },
    ],
  },
  {
    type: "action_add_tag",
    label: "Adicionar Tag",
    category: "action",
    icon: Tag,
    color: "#3b82f6",
    description: "Adiciona uma tag ao contato",
    fields: [
      { key: "tag_name", label: "Nome da Tag", type: "text", placeholder: "lead-quente", required: true },
    ],
  },
  {
    type: "action_remove_tag",
    label: "Remover Tag",
    category: "action",
    icon: Tag,
    color: "#3b82f6",
    description: "Remove uma tag do contato",
    fields: [
      { key: "tag_name", label: "Nome da Tag", type: "text", placeholder: "pendente", required: true },
    ],
  },
  {
    type: "action_assign_agent",
    label: "Atribuir Atendente",
    category: "action",
    icon: UserPlus,
    color: "#3b82f6",
    description: "Atribui a conversa a um atendente",
    fields: [
      { key: "agent_email", label: "Email do Atendente", type: "text", placeholder: "atendente@empresa.com", required: true },
    ],
  },
  {
    type: "action_move_funnel",
    label: "Mover no Funil",
    category: "action",
    icon: ArrowRight,
    color: "#3b82f6",
    description: "Move o contato para outra etapa do funil",
    fields: [
      { key: "funnel_name", label: "Nome do Funil", type: "text", placeholder: "Vendas" },
      { key: "stage_name", label: "Nome da Etapa", type: "text", placeholder: "Negociação" },
    ],
  },
  {
    type: "action_delay",
    label: "Aguardar / Delay",
    category: "action",
    icon: Timer,
    color: "#3b82f6",
    description: "Aguarda um tempo antes de continuar",
    fields: [
      { key: "duration", label: "Duração", type: "number", placeholder: "30", required: true },
      { key: "unit", label: "Unidade", type: "select", options: [{ value: "seconds", label: "Segundos" }, { value: "minutes", label: "Minutos" }, { value: "hours", label: "Horas" }, { value: "days", label: "Dias" }], defaultValue: "minutes" },
    ],
  },
  {
    type: "action_llm_reply",
    label: "Resposta IA (LLM)",
    category: "action",
    icon: Bot,
    color: "#8b5cf6",
    description: "Gera uma resposta automática usando IA",
    fields: [
      { key: "system_prompt", label: "Prompt do Sistema", type: "textarea", placeholder: "Você é um assistente de vendas...", required: true },
      { key: "provider", label: "Provedor", type: "select", options: [
        { value: "openai", label: "OpenAI" },
        { value: "gemini", label: "Google Gemini" },
      ], defaultValue: "openai" },
      { key: "model", label: "Modelo", type: "select", options: [
        // OpenAI
        { value: "gpt-4o", label: "GPT-4o — Multimodal (texto, imagem, áudio)" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini — Rápido e econômico" },
        { value: "gpt-4-turbo", label: "GPT-4 Turbo — Contexto 128k" },
        { value: "gpt-4", label: "GPT-4 — Raciocínio avançado" },
        { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo — Rápido e acessível" },
        { value: "o1", label: "o1 — Raciocínio complexo multi-etapa" },
        { value: "o1-mini", label: "o1 Mini — Raciocínio rápido" },
        { value: "o3-mini", label: "o3 Mini — Raciocínio otimizado" },
        // Gemini
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro — Top multimodal + raciocínio" },
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash — Balanceado custo/qualidade" },
        { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite — Mais rápido/econômico" },
        { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash — Multimodal rápido" },
        { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro — Contexto 2M tokens" },
        { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash — Contexto 1M rápido" },
        // Especializados
        { value: "whisper-1", label: "Whisper — Transcrição de áudio → texto (OpenAI)" },
        { value: "dall-e-3", label: "DALL·E 3 — Geração de imagens (OpenAI)" },
        { value: "dall-e-2", label: "DALL·E 2 — Geração/edição de imagens (OpenAI)" },
        { value: "tts-1", label: "TTS-1 — Texto → áudio (OpenAI)" },
        { value: "tts-1-hd", label: "TTS-1 HD — Texto → áudio alta definição (OpenAI)" },
        { value: "imagen-3", label: "Imagen 3 — Geração de imagens (Google)" },
        { value: "gemini-pro-vision", label: "Gemini Pro Vision — Análise imagens/vídeos" },
      ], defaultValue: "gpt-4o-mini" },
      { key: "max_tokens", label: "Max Tokens", type: "number", placeholder: "500", defaultValue: 500 },
    ],
  },
  {
    type: "action_http_webhook",
    label: "HTTP Webhook",
    category: "action",
    icon: Globe,
    color: "#3b82f6",
    description: "Faz uma requisição HTTP para uma URL externa",
    fields: [
      { key: "url", label: "URL", type: "text", placeholder: "https://api.exemplo.com/webhook", required: true },
      { key: "method", label: "Método", type: "select", options: [{ value: "POST", label: "POST" }, { value: "GET", label: "GET" }, { value: "PUT", label: "PUT" }], defaultValue: "POST" },
      { key: "headers", label: "Headers (JSON)", type: "textarea", placeholder: '{"Authorization": "Bearer ..."}' },
      { key: "body_template", label: "Body Template", type: "textarea", placeholder: '{"phone": "{{phone}}", "name": "{{nome}}"}' },
    ],
  },
  {
    type: "action_elevenlabs_tts",
    label: "Áudio (ElevenLabs)",
    category: "action",
    icon: Volume2,
    color: "#8b5cf6",
    description: "Converte texto em áudio e envia como mensagem de voz",
    fields: [
      { key: "text", label: "Texto para falar", type: "textarea", placeholder: "Olá {{nome}}, obrigado pelo contato!", required: true },
      { key: "voice_id", label: "Voice ID", type: "text", placeholder: "21m00Tcm4TlvDq8ikWAM" },
    ],
  },
  {
    type: "action_update_score",
    label: "Atualizar Score",
    category: "action",
    icon: BarChart3,
    color: "#3b82f6",
    description: "Adiciona ou remove pontos do lead score",
    fields: [
      { key: "points", label: "Pontos", type: "number", placeholder: "10", required: true },
      { key: "operation", label: "Operação", type: "select", options: [{ value: "add", label: "Adicionar" }, { value: "subtract", label: "Subtrair" }, { value: "set", label: "Definir" }], defaultValue: "add" },
    ],
  },
  {
    type: "action_ab_split",
    label: "Split A/B",
    category: "action",
    icon: GitBranch,
    color: "#8b5cf6",
    description: "Divide o fluxo em caminhos A e B com percentual configurável",
    fields: [
      { key: "split_percentage", label: "% para caminho A", type: "number", placeholder: "50", defaultValue: 50 },
    ],
  },
  {
    type: "action_set_variable",
    label: "Definir Variável",
    category: "action",
    icon: Variable,
    color: "#3b82f6",
    description: "Define uma variável customizada para uso no fluxo",
    fields: [
      { key: "variable_name", label: "Nome da Variável", type: "text", placeholder: "status_cliente", required: true },
      { key: "variable_value", label: "Valor", type: "text", placeholder: "ativo", required: true },
    ],
  },

  // ── Multimodal Nodes ──────────────────────────────────
  {
    type: "condition_media_type",
    label: "Tipo de Mídia",
    category: "condition",
    icon: FileType,
    color: "#f59e0b",
    description: "Verifica o tipo de mídia da mensagem (texto, áudio, documento, imagem)",
    fields: [
      { key: "media_type", label: "Tipo esperado", type: "select", options: [
        { value: "text", label: "Texto" },
        { value: "audio", label: "Áudio" },
        { value: "document", label: "Documento (PDF, DOC...)" },
        { value: "image", label: "Imagem" },
        { value: "video", label: "Vídeo" },
      ], defaultValue: "text", required: true },
    ],
  },
  {
    type: "action_collect_messages",
    label: "Aguardar & Agrupar",
    category: "action",
    icon: Layers,
    color: "#8b5cf6",
    description: "Aguarda um intervalo e agrupa todas as mensagens recebidas antes de responder",
    fields: [
      { key: "wait_seconds", label: "Tempo de espera (segundos)", type: "number", placeholder: "15", defaultValue: 15, required: true },
      { key: "max_messages", label: "Máx. mensagens para agrupar", type: "number", placeholder: "10", defaultValue: 10 },
    ],
  },
  {
    type: "action_transcribe_audio",
    label: "Transcrever Áudio",
    category: "action",
    icon: AudioLines,
    color: "#8b5cf6",
    description: "Transcreve o áudio da mensagem em texto usando IA (Whisper / ElevenLabs)",
    fields: [
      { key: "provider", label: "Provedor", type: "select", options: [
        { value: "whisper", label: "OpenAI Whisper" },
        { value: "elevenlabs", label: "ElevenLabs Scribe" },
      ], defaultValue: "whisper" },
      { key: "language", label: "Idioma", type: "text", placeholder: "pt", defaultValue: "pt" },
    ],
  },
  {
    type: "action_extract_pdf",
    label: "Extrair Texto PDF",
    category: "action",
    icon: FileText,
    color: "#8b5cf6",
    description: "Extrai o conteúdo textual de um documento PDF enviado pelo cliente",
    fields: [
      { key: "max_pages", label: "Máx. páginas", type: "number", placeholder: "10", defaultValue: 10 },
      { key: "summarize", label: "Resumir conteúdo com IA", type: "switch", defaultValue: false },
    ],
  },
];

export const getNodeTypeConfig = (type: string) =>
  NODE_TYPES.find((n) => n.type === type);

export const getCategoryLabel = (cat: NodeCategory) =>
  cat === "trigger" ? "Gatilhos" : cat === "condition" ? "Condições" : "Ações";

export const getCategoryColor = (cat: NodeCategory) =>
  cat === "trigger" ? "#22c55e" : cat === "condition" ? "#f59e0b" : "#3b82f6";
