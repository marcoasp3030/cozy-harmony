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

/**
 * Qualificação de Leads: Classifica intenção → scoring → move no funil
 */
export function createLeadQualificationTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    {
      id: "lq_trigger",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_message" },
    },
    {
      id: "lq_collect",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: { nodeType: "action_collect_messages", wait_seconds: 10, max_messages: 5 },
    },
    {
      id: "lq_classify",
      type: "flowNode",
      position: { x: X, y: 260 },
      data: {
        nodeType: "condition_intent_classifier",
        intents: "compra, orçamento, dúvida, suporte, saudação",
        confidence_threshold: 50,
        custom_prompt: "Classifique se o lead tem intenção de compra/orçamento (quente) ou apenas dúvida/suporte (frio).",
      },
    },
    {
      id: "lq_hot_score",
      type: "flowNode",
      position: { x: X + 280, y: 420 },
      data: { nodeType: "action_update_score", points: "30", operation: "add" },
    },
    {
      id: "lq_hot_tag",
      type: "flowNode",
      position: { x: X + 280, y: 560 },
      data: { nodeType: "action_add_tag", tag_name: "lead-quente" },
    },
    {
      id: "lq_hot_funnel",
      type: "flowNode",
      position: { x: X + 280, y: 700 },
      data: { nodeType: "action_move_funnel", funnel_name: "Vendas", stage_name: "Qualificado" },
    },
    {
      id: "lq_hot_msg",
      type: "flowNode",
      position: { x: X + 280, y: 840 },
      data: {
        nodeType: "action_send_message",
        message: "Ótimo, {{nome}}! 🔥 Vi que você tem interesse em nossos produtos/serviços.\n\nVou te conectar com um especialista que vai te ajudar com o melhor orçamento. Aguarde um momento! 🚀",
      },
    },
    {
      id: "lq_cold_score",
      type: "flowNode",
      position: { x: X - 280, y: 420 },
      data: { nodeType: "action_update_score", points: "5", operation: "add" },
    },
    {
      id: "lq_cold_tag",
      type: "flowNode",
      position: { x: X - 280, y: 560 },
      data: { nodeType: "action_add_tag", tag_name: "lead-frio" },
    },
    {
      id: "lq_cold_ia",
      type: "flowNode",
      position: { x: X - 280, y: 700 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt: "Você é um assistente de atendimento. O cliente parece ter uma dúvida ou precisa de suporte. Responda de forma útil, objetiva e amigável. Tente entender a necessidade e, se possível, direcione para uma oportunidade de venda de forma sutil.",
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 400,
      },
    },
  ];

  const edges: Edge[] = [
    makeEdge("lq_trigger", "lq_collect"),
    makeEdge("lq_collect", "lq_classify"),
    makeEdge("lq_classify", "lq_hot_score", "yes"),
    makeEdge("lq_hot_score", "lq_hot_tag"),
    makeEdge("lq_hot_tag", "lq_hot_funnel"),
    makeEdge("lq_hot_funnel", "lq_hot_msg"),
    makeEdge("lq_classify", "lq_cold_score", "no"),
    makeEdge("lq_cold_score", "lq_cold_tag"),
    makeEdge("lq_cold_tag", "lq_cold_ia"),
  ];

  return {
    id: "qualificacao_leads",
    name: "Qualificação de Leads",
    description: "Classifica intenção com IA, aplica scoring automático e move leads quentes para o funil de vendas",
    emoji: "🎯",
    triggerType: "message",
    nodes,
    edges,
  };
}

/**
 * Agendamento de Reuniões: Coleta dados → confirma → agenda
 */
export function createMeetingScheduleTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    {
      id: "meet_trigger",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_keyword", keywords: "agendar,reunião,reuniao,meeting,horário,agenda,marcar", match_type: "contains" },
    },
    {
      id: "meet_hours_check",
      type: "flowNode",
      position: { x: X, y: 140 },
      data: { nodeType: "condition_business_hours", use_saved_config: true, out_of_hours_message: "" },
    },
    {
      id: "meet_out_msg",
      type: "flowNode",
      position: { x: X - 280, y: 300 },
      data: {
        nodeType: "action_send_message",
        message: "Olá {{nome}}! ⏰\n\nEstamos fora do horário de atendimento agora.\n\nNossos horários disponíveis são de segunda a sexta, das 09:00 às 18:00.\n\nEnvie uma mensagem no próximo dia útil e agendaremos sua reunião! 📅",
      },
    },
    {
      id: "meet_welcome",
      type: "flowNode",
      position: { x: X + 280, y: 300 },
      data: {
        nodeType: "action_send_message",
        message: "Olá {{nome}}! 📅 Vamos agendar sua reunião.\n\nPor favor, me informe:\n\n1️⃣ Qual o assunto da reunião?\n2️⃣ Data e horário de preferência?\n3️⃣ Será presencial ou online?\n\nPode responder em uma única mensagem! 😊",
      },
    },
    {
      id: "meet_collect",
      type: "flowNode",
      position: { x: X + 280, y: 460 },
      data: { nodeType: "action_collect_messages", wait_seconds: 20, max_messages: 5 },
    },
    {
      id: "meet_tag",
      type: "flowNode",
      position: { x: X + 280, y: 600 },
      data: { nodeType: "action_add_tag", tag_name: "agendamento-pendente" },
    },
    {
      id: "meet_score",
      type: "flowNode",
      position: { x: X + 280, y: 740 },
      data: { nodeType: "action_update_score", points: "15", operation: "add" },
    },
    {
      id: "meet_ia_confirm",
      type: "flowNode",
      position: { x: X + 280, y: 880 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt: "Você é um assistente de agendamento. O cliente quer marcar uma reunião e enviou informações sobre data, horário e assunto.\n\nRegras:\n1. Extraia e confirme: assunto, data/horário sugerido e formato (presencial/online).\n2. Se faltar alguma informação, pergunte educadamente.\n3. Confirme o agendamento de forma clara e profissional.\n4. Informe que a equipe vai confirmar a disponibilidade em breve.\n5. Seja objetivo — máximo 2 parágrafos.",
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 400,
      },
    },
    {
      id: "meet_webhook",
      type: "flowNode",
      position: { x: X + 280, y: 1020 },
      data: {
        nodeType: "action_http_webhook",
        url: "https://seu-sistema.com/api/agendamentos",
        method: "POST",
        headers: '{"Content-Type": "application/json"}',
        body_template: '{"phone": "{{phone}}", "name": "{{nome}}", "message": "{{mensagens_agrupadas}}"}',
      },
    },
  ];

  const edges: Edge[] = [
    makeEdge("meet_trigger", "meet_hours_check"),
    makeEdge("meet_hours_check", "meet_welcome", "yes"),
    makeEdge("meet_hours_check", "meet_out_msg", "no"),
    makeEdge("meet_welcome", "meet_collect"),
    makeEdge("meet_collect", "meet_tag"),
    makeEdge("meet_tag", "meet_score"),
    makeEdge("meet_score", "meet_ia_confirm"),
    makeEdge("meet_ia_confirm", "meet_webhook"),
  ];

  return {
    id: "agendamento_reunioes",
    name: "Agendamento de Reuniões",
    description: "Coleta dados de agendamento, confirma com IA e envia para webhook externo",
    emoji: "📅",
    triggerType: "keyword",
    nodes,
    edges,
  };
}

/**
 * Pesquisa NPS: Pergunta nota → classifica → agradece ou escala
 */
export function createNPSTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    {
      id: "nps_trigger",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_keyword", keywords: "nps,pesquisa,satisfação,satisfacao,avaliar,avaliação", match_type: "contains" },
    },
    {
      id: "nps_ask",
      type: "flowNode",
      position: { x: X, y: 140 },
      data: {
        nodeType: "action_send_message",
        message: "Olá {{nome}}! 📊\n\nGostaríamos de saber como foi sua experiência conosco.\n\nEm uma escala de *0 a 10*, o quanto você recomendaria nossos serviços para um amigo ou colega?\n\nResponda apenas com o número! 🙏",
      },
    },
    {
      id: "nps_collect",
      type: "flowNode",
      position: { x: X, y: 280 },
      data: { nodeType: "action_collect_messages", wait_seconds: 20, max_messages: 3 },
    },
    {
      id: "nps_set_var",
      type: "flowNode",
      position: { x: X, y: 420 },
      data: { nodeType: "action_set_variable", variable_name: "nps_resposta", variable_value: "{{mensagens_agrupadas}}" },
    },
    {
      id: "nps_classify",
      type: "flowNode",
      position: { x: X, y: 560 },
      data: {
        nodeType: "condition_intent_classifier",
        intents: "promotor, neutro, detrator",
        confidence_threshold: 40,
        custom_prompt: "Analise a resposta do NPS. Se o número é 9 ou 10: promotor. Se 7 ou 8: neutro. Se 0 a 6: detrator. Se não for um número, tente inferir pelo sentimento da mensagem.",
      },
    },
    {
      id: "nps_promoter_msg",
      type: "flowNode",
      position: { x: X + 300, y: 720 },
      data: {
        nodeType: "action_send_message",
        message: "Que maravilha, {{nome}}! 🎉🥳\n\nFicamos muito felizes com sua avaliação! Seu feedback nos motiva a continuar melhorando.\n\nSe quiser, compartilhe sua experiência com amigos. Isso nos ajuda muito! 💚\n\nMuito obrigado! 🙏",
      },
    },
    {
      id: "nps_promoter_tag",
      type: "flowNode",
      position: { x: X + 300, y: 860 },
      data: { nodeType: "action_add_tag", tag_name: "nps-promotor" },
    },
    {
      id: "nps_promoter_score",
      type: "flowNode",
      position: { x: X + 300, y: 1000 },
      data: { nodeType: "action_update_score", points: "25", operation: "add" },
    },
    {
      id: "nps_detractor_msg",
      type: "flowNode",
      position: { x: X - 300, y: 720 },
      data: {
        nodeType: "action_send_message",
        message: "Obrigado pelo seu feedback, {{nome}}. 🙏\n\nLamentamos que sua experiência não tenha sido a melhor. Seu retorno é muito importante para nós.\n\nPoderia nos contar o que podemos melhorar? Vou encaminhar para nossa equipe de qualidade. 💬",
      },
    },
    {
      id: "nps_detractor_tag",
      type: "flowNode",
      position: { x: X - 300, y: 860 },
      data: { nodeType: "action_add_tag", tag_name: "nps-detrator" },
    },
    {
      id: "nps_detractor_score",
      type: "flowNode",
      position: { x: X - 300, y: 1000 },
      data: { nodeType: "action_update_score", points: "10", operation: "add" },
    },
    {
      id: "nps_webhook",
      type: "flowNode",
      position: { x: X, y: 1160 },
      data: {
        nodeType: "action_http_webhook",
        url: "https://seu-sistema.com/api/nps",
        method: "POST",
        headers: '{"Content-Type": "application/json"}',
        body_template: '{"phone": "{{phone}}", "name": "{{nome}}", "nps": "{{nps_resposta}}", "intent": "{{intencao}}"}',
      },
    },
  ];

  const edges: Edge[] = [
    makeEdge("nps_trigger", "nps_ask"),
    makeEdge("nps_ask", "nps_collect"),
    makeEdge("nps_collect", "nps_set_var"),
    makeEdge("nps_set_var", "nps_classify"),
    makeEdge("nps_classify", "nps_promoter_msg", "yes"),
    makeEdge("nps_promoter_msg", "nps_promoter_tag"),
    makeEdge("nps_promoter_tag", "nps_promoter_score"),
    makeEdge("nps_promoter_score", "nps_webhook"),
    makeEdge("nps_classify", "nps_detractor_msg", "no"),
    makeEdge("nps_detractor_msg", "nps_detractor_tag"),
    makeEdge("nps_detractor_tag", "nps_detractor_score"),
    makeEdge("nps_detractor_score", "nps_webhook"),
  ];

  return {
    id: "pesquisa_nps",
    name: "Pesquisa NPS",
    description: "Pesquisa de satisfação com classificação automática (Promotor/Detrator) e webhook",
    emoji: "📊",
    triggerType: "keyword",
    nodes,
    edges,
  };
}

/**
 * Remarketing: Agendamento diário → busca inativos → oferta personalizada
 */
export function createRemarketingTemplate(): FlowTemplate {
  const X = 350;
  const nodes: Node[] = [
    {
      id: "rmk_trigger",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_schedule", cron: "0 10 * * 1-5", timezone: "America/Sao_Paulo" },
    },
    {
      id: "rmk_check_hours",
      type: "flowNode",
      position: { x: X, y: 140 },
      data: { nodeType: "condition_business_hours", use_saved_config: true, out_of_hours_message: "" },
    },
    // Dentro do expediente → verificar campo do contato (tem nome)
    {
      id: "rmk_check_name",
      type: "flowNode",
      position: { x: X + 280, y: 300 },
      data: { nodeType: "condition_contact_field", field: "name", operator: "exists", value: "" },
    },
    // Com nome → mensagem personalizada
    {
      id: "rmk_msg_personal",
      type: "flowNode",
      position: { x: X + 280, y: 460 },
      data: {
        nodeType: "action_send_message",
        message: "Oi {{nome}}! 👋 Faz um tempinho que não conversamos.\n\nPassei aqui para avisar que temos uma *oferta especial* pensada para você:\n\n🎁 *20% OFF* em todos os nossos serviços\n⏰ Válido por 48 horas\n\nQuer saber mais? É só responder esta mensagem! 🚀",
      },
    },
    // Sem nome → mensagem genérica
    {
      id: "rmk_msg_generic",
      type: "flowNode",
      position: { x: X - 280, y: 460 },
      data: {
        nodeType: "action_send_message",
        message: "Olá! 👋 Sentimos sua falta por aqui.\n\nTemos uma *promoção exclusiva* para clientes especiais como você:\n\n🎁 *20% de desconto* em qualquer serviço\n⏰ Por tempo limitado!\n\nResponda *SIM* para aproveitar! 😊",
      },
    },
    // Tag remarketing
    {
      id: "rmk_tag",
      type: "flowNode",
      position: { x: X, y: 620 },
      data: { nodeType: "action_add_tag", tag_name: "remarketing-enviado" },
    },
    // Score
    {
      id: "rmk_score",
      type: "flowNode",
      position: { x: X, y: 760 },
      data: { nodeType: "action_update_score", points: "10", operation: "add" },
    },
    // Mover no funil
    {
      id: "rmk_funnel",
      type: "flowNode",
      position: { x: X, y: 900 },
      data: { nodeType: "action_move_funnel", funnel_name: "Vendas", stage_name: "Reengajamento" },
    },
    // Webhook para CRM externo
    {
      id: "rmk_webhook",
      type: "flowNode",
      position: { x: X, y: 1040 },
      data: {
        nodeType: "action_http_webhook",
        url: "https://seu-crm.com/api/remarketing",
        method: "POST",
        headers: '{"Content-Type": "application/json"}',
        body_template: '{"phone": "{{phone}}", "name": "{{nome}}", "campaign": "remarketing-7d"}',
      },
    },
  ];

  const edges: Edge[] = [
    makeEdge("rmk_trigger", "rmk_check_hours"),
    makeEdge("rmk_check_hours", "rmk_check_name", "yes"),
    makeEdge("rmk_check_name", "rmk_msg_personal", "yes"),
    makeEdge("rmk_check_name", "rmk_msg_generic", "no"),
    makeEdge("rmk_msg_personal", "rmk_tag"),
    makeEdge("rmk_msg_generic", "rmk_tag"),
    makeEdge("rmk_tag", "rmk_score"),
    makeEdge("rmk_score", "rmk_funnel"),
    makeEdge("rmk_funnel", "rmk_webhook"),
  ];

  return {
    id: "remarketing_inativos",
    name: "Remarketing Inativos",
    description: "Reengaja leads inativos há 7+ dias com oferta personalizada, scoring e webhook para CRM",
    emoji: "🔄",
    triggerType: "schedule",
    nodes,
    edges,
  };
}

export const ALL_TEMPLATES: (() => FlowTemplate)[] = [
  createSACTemplate,
  createWelcomeTemplate,
  createBusinessHoursTemplate,
  createMultimodalTemplate,
  createLeadQualificationTemplate,
  createMeetingScheduleTemplate,
  createNPSTemplate,
  createRemarketingTemplate,
];
