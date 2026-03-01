import type { Node, Edge } from "@xyflow/react";

const edgeStyle = {
  animated: true,
  style: { strokeWidth: 2, stroke: "hsl(var(--primary))" },
  markerEnd: { type: "arrowclosed" as any, color: "hsl(var(--primary))" },
};

const makeEdge = (source: string, target: string, sourceHandle?: string): Edge => ({
  id: `e_${source}_${target}${sourceHandle ? `_${sourceHandle}` : ""}`,
  source,
  target,
  sourceHandle,
  ...edgeStyle,
});

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  triggerType: string;
  nodes: Node[];
  edges: Edge[];
}

/**
 * SAC completo: Menu interativo → rotas (Dúvidas, Reclamações, Lojas, Pagamentos) → IA fallback
 */
export function createSACTemplate(): FlowTemplate {
  const X = 350; // center X
  const nodes: Node[] = [
    // 1. Gatilho
    {
      id: "trigger_message_sac",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_message" },
    },
    // 2. Mensagem de boas-vindas + menu
    {
      id: "sac_welcome",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: {
        nodeType: "action_send_message",
        message:
          "Olá {{nome}}! 👋 Bem-vindo ao nosso SAC.\n\nComo podemos te ajudar hoje? Por favor, escolha uma opção:\n\n1️⃣ Dúvidas gerais\n2️⃣ Reclamações\n3️⃣ Problemas nas lojas\n4️⃣ Pagamentos / PIX\n5️⃣ Falar com atendente\n\nDigite o número da opção desejada.",
      },
    },
    // 3. Condição: contém "1" ou "dúvida"
    {
      id: "sac_cond_duvidas",
      type: "flowNode",
      position: { x: X - 500, y: 280 },
      data: {
        nodeType: "condition_contains",
        text: "1,dúvida,duvida,dúvidas,duvidas",
        case_sensitive: false,
      },
    },
    // 4. Condição: contém "2" ou "reclamação"
    {
      id: "sac_cond_reclamacao",
      type: "flowNode",
      position: { x: X - 170, y: 280 },
      data: {
        nodeType: "condition_contains",
        text: "2,reclamação,reclamacao,reclamar",
        case_sensitive: false,
      },
    },
    // 5. Condição: contém "3" ou "loja"
    {
      id: "sac_cond_lojas",
      type: "flowNode",
      position: { x: X + 170, y: 280 },
      data: {
        nodeType: "condition_contains",
        text: "3,loja,lojas,problema na loja",
        case_sensitive: false,
      },
    },
    // 6. Condição: contém "4" ou "pix" ou "pagamento"
    {
      id: "sac_cond_pagamento",
      type: "flowNode",
      position: { x: X + 500, y: 280 },
      data: {
        nodeType: "condition_contains",
        text: "4,pix,pagamento,pagar,pagamentos",
        case_sensitive: false,
      },
    },

    // ── Respostas para cada rota ──

    // Dúvidas → IA responde
    {
      id: "sac_duvidas_ia",
      type: "flowNode",
      position: { x: X - 500, y: 440 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          "Você é um assistente de SAC amigável e prestativo. O cliente tem uma dúvida geral. Responda de forma clara, objetiva e empática. Se não souber a resposta, diga que vai encaminhar para um especialista. Sempre finalize perguntando se pode ajudar em mais alguma coisa.",
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 500,
      },
    },
    {
      id: "sac_duvidas_tag",
      type: "flowNode",
      position: { x: X - 500, y: 600 },
      data: { nodeType: "action_add_tag", tag_name: "sac-duvida" },
    },

    // Reclamação → mensagem empática + tag + atribuir atendente
    {
      id: "sac_reclamacao_msg",
      type: "flowNode",
      position: { x: X - 170, y: 440 },
      data: {
        nodeType: "action_send_message",
        message:
          "Lamentamos muito pela sua experiência, {{nome}}. 😔\n\nSua reclamação é muito importante para nós. Vou registrar e encaminhar para nossa equipe responsável.\n\nPor favor, descreva com detalhes o que aconteceu para que possamos resolver o mais rápido possível.",
      },
    },
    {
      id: "sac_reclamacao_tag",
      type: "flowNode",
      position: { x: X - 170, y: 600 },
      data: { nodeType: "action_add_tag", tag_name: "sac-reclamacao" },
    },
    {
      id: "sac_reclamacao_score",
      type: "flowNode",
      position: { x: X - 170, y: 740 },
      data: { nodeType: "action_update_score", points: "20", operation: "add" },
    },

    // Problemas nas lojas → mensagem + tag
    {
      id: "sac_lojas_msg",
      type: "flowNode",
      position: { x: X + 170, y: 440 },
      data: {
        nodeType: "action_send_message",
        message:
          "Entendemos, {{nome}}. Problemas nas lojas são prioridade para nós! 🏪\n\nPor favor, informe:\n📍 Qual loja?\n📅 Quando aconteceu?\n📝 Descreva o problema\n\nNossa equipe vai analisar e retornar em breve.",
      },
    },
    {
      id: "sac_lojas_tag",
      type: "flowNode",
      position: { x: X + 170, y: 600 },
      data: { nodeType: "action_add_tag", tag_name: "sac-problema-loja" },
    },

    // Pagamento → envia chave PIX
    {
      id: "sac_pagamento_msg",
      type: "flowNode",
      position: { x: X + 500, y: 440 },
      data: {
        nodeType: "action_send_message",
        message:
          "Certo, {{nome}}! Aqui estão os dados para pagamento via PIX: 💳\n\n🔑 *Chave PIX:* sua-chave-pix@email.com\n👤 *Nome:* Sua Empresa LTDA\n🏦 *Banco:* Banco X\n\n⚠️ *Importante:* Confira sempre o nome do beneficiário antes de confirmar o pagamento.\n\nApós realizar o pagamento, envie o comprovante aqui para confirmarmos! ✅",
      },
    },
    {
      id: "sac_pagamento_tag",
      type: "flowNode",
      position: { x: X + 500, y: 600 },
      data: { nodeType: "action_add_tag", tag_name: "sac-pagamento" },
    },

    // Fallback IA (condição "5" ou nenhuma opção)
    {
      id: "sac_fallback_ia",
      type: "flowNode",
      position: { x: X, y: 880 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          "Você é um assistente de SAC. O cliente não escolheu uma opção do menu ou pediu para falar com atendente. Tente entender o que ele precisa e responda de forma útil. Se não conseguir resolver, diga que está encaminhando para um atendente humano e peça para aguardar. Seja empático e profissional.",
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 500,
      },
    },
    {
      id: "sac_fallback_tag",
      type: "flowNode",
      position: { x: X, y: 1020 },
      data: { nodeType: "action_add_tag", tag_name: "sac-ia-fallback" },
    },
  ];

  const edges: Edge[] = [
    // Trigger → Welcome
    makeEdge("trigger_message_sac", "sac_welcome"),
    // Welcome → all conditions
    makeEdge("sac_welcome", "sac_cond_duvidas"),
    makeEdge("sac_welcome", "sac_cond_reclamacao"),
    makeEdge("sac_welcome", "sac_cond_lojas"),
    makeEdge("sac_welcome", "sac_cond_pagamento"),

    // Dúvidas: yes → IA, no → next check (handled by flow)
    makeEdge("sac_cond_duvidas", "sac_duvidas_ia", "yes"),
    makeEdge("sac_duvidas_ia", "sac_duvidas_tag"),

    // Reclamação: yes → msg
    makeEdge("sac_cond_reclamacao", "sac_reclamacao_msg", "yes"),
    makeEdge("sac_reclamacao_msg", "sac_reclamacao_tag"),
    makeEdge("sac_reclamacao_tag", "sac_reclamacao_score"),

    // Lojas: yes → msg
    makeEdge("sac_cond_lojas", "sac_lojas_msg", "yes"),
    makeEdge("sac_lojas_msg", "sac_lojas_tag"),

    // Pagamento: yes → PIX msg
    makeEdge("sac_cond_pagamento", "sac_pagamento_msg", "yes"),
    makeEdge("sac_pagamento_msg", "sac_pagamento_tag"),

    // Fallback: all "no" paths → IA fallback
    makeEdge("sac_cond_duvidas", "sac_cond_reclamacao", "no"),
    makeEdge("sac_cond_reclamacao", "sac_cond_lojas", "no"),
    makeEdge("sac_cond_lojas", "sac_cond_pagamento", "no"),
    makeEdge("sac_cond_pagamento", "sac_fallback_ia", "no"),
    makeEdge("sac_fallback_ia", "sac_fallback_tag"),
  ];

  return {
    id: "sac_completo",
    name: "SAC Completo",
    description: "Fluxo de atendimento com menu (Dúvidas, Reclamações, Lojas, Pagamentos), IA e PIX",
    emoji: "🎧",
    triggerType: "message",
    nodes,
    edges,
  };
}

/**
 * Template de boas-vindas simples
 */
export function createWelcomeTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    {
      id: "trigger_first_contact_welcome",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_first_contact" },
    },
    {
      id: "welcome_msg",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: {
        nodeType: "action_send_message",
        message: "Olá {{nome}}! 👋 Seja bem-vindo(a)!\n\nComo posso te ajudar hoje?",
      },
    },
    {
      id: "welcome_tag",
      type: "flowNode",
      position: { x: X, y: 260 },
      data: { nodeType: "action_add_tag", tag_name: "novo-contato" },
    },
  ];

  const edges: Edge[] = [
    makeEdge("trigger_first_contact_welcome", "welcome_msg"),
    makeEdge("welcome_msg", "welcome_tag"),
  ];

  return {
    id: "boas_vindas",
    name: "Boas-vindas",
    description: "Mensagem automática para novos contatos com tag",
    emoji: "👋",
    triggerType: "first_contact",
    nodes,
    edges,
  };
}

/**
 * Template de horário de expediente
 */
export function createBusinessHoursTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    {
      id: "trigger_msg_bh",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_message" },
    },
    {
      id: "check_hours",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: {
        nodeType: "condition_business_hours",
        use_saved_config: true,
        out_of_hours_message: "",
      },
    },
    {
      id: "in_hours_ia",
      type: "flowNode",
      position: { x: X + 200, y: 280 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt: "Você é um assistente virtual. Responda de forma útil e profissional.",
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 500,
      },
    },
    {
      id: "out_hours_msg",
      type: "flowNode",
      position: { x: X - 200, y: 280 },
      data: {
        nodeType: "action_send_message",
        message:
          "Olá {{nome}}! ⏰\n\nNo momento estamos fora do horário de atendimento.\n\nNosso horário é de segunda a sexta, das 08:00 às 18:00.\n\nDeixe sua mensagem que responderemos assim que possível! 😊",
      },
    },
  ];

  const edges: Edge[] = [
    makeEdge("trigger_msg_bh", "check_hours"),
    makeEdge("check_hours", "in_hours_ia", "yes"),
    makeEdge("check_hours", "out_hours_msg", "no"),
  ];

  return {
    id: "horario_expediente",
    name: "Horário de Expediente",
    description: "Verifica expediente e responde com IA ou mensagem de ausência",
    emoji: "⏰",
    triggerType: "message",
    nodes,
    edges,
  };
}

/**
 * Template multimodal: texto, áudio, PDF → agrupamento → IA humanizada
 */
export function createMultimodalTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    // 1. Gatilho
    {
      id: "trigger_msg_multi",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_message" },
    },
    // 2. Agrupar mensagens (espera 15s para o cliente enviar tudo)
    {
      id: "multi_collect",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: {
        nodeType: "action_collect_messages",
        wait_seconds: 15,
        max_messages: 10,
      },
    },
    // 3. Verificar se há áudio
    {
      id: "multi_check_audio",
      type: "flowNode",
      position: { x: X - 300, y: 280 },
      data: { nodeType: "condition_media_type", media_type: "audio" },
    },
    // 4. Verificar se há documento (PDF)
    {
      id: "multi_check_doc",
      type: "flowNode",
      position: { x: X + 300, y: 280 },
      data: { nodeType: "condition_media_type", media_type: "document" },
    },

    // ── Rota Áudio ──
    {
      id: "multi_transcribe",
      type: "flowNode",
      position: { x: X - 300, y: 440 },
      data: {
        nodeType: "action_transcribe_audio",
        provider: "whisper",
        language: "pt",
      },
    },
    {
      id: "multi_audio_tag",
      type: "flowNode",
      position: { x: X - 300, y: 580 },
      data: { nodeType: "action_add_tag", tag_name: "enviou-audio" },
    },

    // ── Rota Documento ──
    {
      id: "multi_extract_pdf",
      type: "flowNode",
      position: { x: X + 300, y: 440 },
      data: {
        nodeType: "action_extract_pdf",
        max_pages: 10,
        summarize: true,
      },
    },
    {
      id: "multi_doc_tag",
      type: "flowNode",
      position: { x: X + 300, y: 580 },
      data: { nodeType: "action_add_tag", tag_name: "enviou-documento" },
    },

    // ── Resposta IA Humanizada (convergência) ──
    {
      id: "multi_ia_reply",
      type: "flowNode",
      position: { x: X, y: 740 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          "Você é um atendente de SAC humano, empático e atencioso. O cliente enviou uma ou mais mensagens que podem incluir texto, transcrições de áudio e/ou conteúdo extraído de documentos PDF.\n\nRegras:\n1. Analise TODAS as mensagens agrupadas como um contexto único — não responda a cada uma separadamente.\n2. Identifique a real necessidade do cliente e responda de forma clara, objetiva e acolhedora.\n3. Use linguagem natural, como se fosse uma conversa pessoal. Evite respostas robóticas.\n4. Se o cliente enviou um documento, referencie o conteúdo naturalmente (\"Vi no documento que você enviou...\").\n5. Se o cliente enviou áudio, trate a transcrição como se ele tivesse falado diretamente com você.\n6. Sempre finalize perguntando se pode ajudar em mais alguma coisa.\n7. Seja conciso — máximo 3 parágrafos.",
        provider: "openai",
        model: "gpt-4o",
        max_tokens: 600,
      },
    },

    // ── Mensagem de acolhimento (texto puro, sem mídia especial) ──
    {
      id: "multi_text_ack",
      type: "flowNode",
      position: { x: X, y: 440 },
      data: {
        nodeType: "action_send_message",
        message: "Recebi suas mensagens, {{nome}}! 📝 Estou analisando tudo para te dar a melhor resposta...",
      },
    },
  ];

  const edges: Edge[] = [
    // Trigger → Collect
    makeEdge("trigger_msg_multi", "multi_collect"),
    // Collect → Check audio & Check doc
    makeEdge("multi_collect", "multi_check_audio"),
    makeEdge("multi_collect", "multi_check_doc"),

    // Audio: yes → transcribe → tag → IA
    makeEdge("multi_check_audio", "multi_transcribe", "yes"),
    makeEdge("multi_transcribe", "multi_audio_tag"),
    makeEdge("multi_audio_tag", "multi_ia_reply"),

    // Audio: no → acknowledgment text → IA
    makeEdge("multi_check_audio", "multi_text_ack", "no"),
    makeEdge("multi_text_ack", "multi_ia_reply"),

    // Doc: yes → extract → tag → IA
    makeEdge("multi_check_doc", "multi_extract_pdf", "yes"),
    makeEdge("multi_extract_pdf", "multi_doc_tag"),
    makeEdge("multi_doc_tag", "multi_ia_reply"),
  ];

  return {
    id: "atendimento_multimodal",
    name: "Atendimento Multimodal",
    description: "Recebe texto, áudio e PDF, agrupa mensagens e responde com IA humanizada",
    emoji: "🎙️",
    triggerType: "message",
    nodes,
    edges,
  };
}

export const ALL_TEMPLATES: (() => FlowTemplate)[] = [
  createSACTemplate,
  createWelcomeTemplate,
  createBusinessHoursTemplate,
  createMultimodalTemplate,
];
