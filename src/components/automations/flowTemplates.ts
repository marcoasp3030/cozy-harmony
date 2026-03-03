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
    // 2. Menu interativo com botões
    {
      id: "sac_welcome",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: {
        nodeType: "action_send_interactive",
        interactive_type: "list",
        body_text: "Olá {{nome}}! 👋 Bem-vindo ao nosso SAC.\n\nComo podemos te ajudar hoje?",
        footer: "Selecione uma opção abaixo",
        button_title: "Ver opções",
        options: "Dúvidas gerais|duvidas|Tire suas dúvidas sobre produtos e serviços\nReclamações|reclamacao|Registre uma reclamação\nProblemas nas lojas|lojas|Reporte problemas em lojas físicas\nPagamentos / PIX|pagamento|Dados bancários e comprovantes\nFalar com atendente|atendente|Atendimento humano",
      },
    },
    // 3. Condição: contém "1" ou "dúvida"
    {
      id: "sac_cond_duvidas",
      type: "flowNode",
      position: { x: X - 500, y: 280 },
      data: {
        nodeType: "condition_contains",
        text: "duvidas,1,dúvida,duvida,dúvidas",
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
        text: "reclamacao,2,reclamação,reclamar",
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
        text: "lojas,3,loja,problema na loja",
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
        text: "pagamento,4,pix,pagar,pagamentos,atendente,5",
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
 * Template Nutricar Brasil: Mini mercados autônomos 24h
 * - Áudio recebido → responde com áudio (TTS)
 * - Pagamento → PIX interativo (nunca por áudio) + pede comprovante
 * - Texto/Doc → IA humanizada
 */
export function createMultimodalTemplate(): FlowTemplate {
  const X = 400;
  const nodes: Node[] = [
    // 1. Gatilho
    {
      id: "trigger_msg_multi",
      type: "flowNode",
      position: { x: X, y: 0 },
      data: { nodeType: "trigger_message" },
    },
    // 2. Imagem de boas-vindas Nutricar
    {
      id: "multi_welcome_media",
      type: "flowNode",
      position: { x: X, y: 120 },
      data: {
        nodeType: "action_send_media",
        media_type: "image",
        media_url: "https://placehold.co/800x400/00843D/ffffff?text=Nutricar+Brasil+%F0%9F%9B%92+Mini+Mercado+24h",
        caption: "Olá! 👋 Seja bem-vindo(a) ao atendimento da Nutricar Brasil 💚\nNossas lojas funcionam 24 horas com tecnologia e segurança para sua comodidade.\n\nComo podemos ajudar você hoje?",
      },
    },
    // 3. Agrupar mensagens
    {
      id: "multi_collect",
      type: "flowNode",
      position: { x: X, y: 260 },
      data: {
        nodeType: "action_collect_messages",
        wait_seconds: 12,
        max_messages: 8,
      },
    },

    // ═══ ROTA 0: ESCALONAMENTO JURÍDICO (antes de tudo) ═══
    {
      id: "multi_check_juridico",
      type: "flowNode",
      position: { x: X, y: 400 },
      data: {
        nodeType: "condition_contains",
        text: "advogado,advogada,processo,processar,procon,juízo,juizo,judicial,jurídico,juridico,justiça,justica,tribunal,intimação,intimacao,denúncia,denuncia,ação judicial,acao judicial,consumidor,indenização,indenizacao,boletim de ocorrência,boletim de ocorrencia,delegacia,polícia,policia,reclame aqui",
        case_sensitive: false,
      },
    },
    // Mensagem de escalonamento
    {
      id: "multi_juridico_msg",
      type: "flowNode",
      position: { x: X, y: 560 },
      data: {
        nodeType: "action_send_message",
        message: "{{nome}}, entendemos a sua preocupação e levamos isso muito a sério. 💚\n\nSeu atendimento será encaminhado para nossa equipe especializada, que vai analisar o caso com toda a atenção necessária.\n\nEm breve você receberá um retorno. Agradecemos a sua paciência! 🙏",
      },
    },
    // Tag jurídica
    {
      id: "multi_juridico_tag",
      type: "flowNode",
      position: { x: X, y: 700 },
      data: { nodeType: "action_add_tag", tag_name: "escalonamento-juridico" },
    },
    // Score alto para prioridade
    {
      id: "multi_juridico_score",
      type: "flowNode",
      position: { x: X, y: 840 },
      data: { nodeType: "action_update_score", points: "50", operation: "add" },
    },

    // ═══ ROTA 1: VERIFICAR ÁUDIO ═══
    {
      id: "multi_check_audio",
      type: "flowNode",
      position: { x: X - 350, y: 560 },
      data: { nodeType: "condition_media_type", media_type: "audio" },
    },
    // Transcrever áudio
    {
      id: "multi_transcribe",
      type: "flowNode",
      position: { x: X - 350, y: 560 },
      data: {
        nodeType: "action_transcribe_audio",
        provider: "whisper",
        language: "pt",
      },
    },
    // Verificar se o áudio fala de pagamento
    {
      id: "multi_audio_pix_check",
      type: "flowNode",
      position: { x: X - 350, y: 700 },
      data: {
        nodeType: "condition_contains",
        text: "pix,pagamento,pagar,cobrou,cobrança,cobranca,cartão,cartao,débito,debito,crédito,credito,maquininha,não passou,nao passou,valor,dinheiro,troco,comprovante,financeiro,boleto,transferência,transferencia,totem,desligado,não funciona,nao funciona,sem funcionar",
        case_sensitive: false,
      },
    },
    // Áudio SEM pagamento → IA gera texto (sem enviar) → TTS envia como áudio
    {
      id: "multi_audio_ia",
      type: "flowNode",
      position: { x: X - 600, y: 860 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          `Você é a atendente virtual da Nutricar Brasil — fale como uma pessoa real, calorosa e resolutiva.

QUEM VOCÊ É: Atendente experiente da Nutricar Brasil, rede de mini mercados autônomos 24h em condomínios e empresas. Você conhece bem o dia a dia dos clientes e se importa genuinamente com cada um.

LOJAS DA REDE: Nutricar Barra Park, Nutricar Asa Norte, Nutricar Águas Claras, Nutricar Sudoeste, Nutricar Lago Sul, Nutricar Noroeste, Nutricar Park Sul, Nutricar Guará, Nutricar Taguatinga, Nutricar Ceilândia (e novas unidades).

COLETA DE DADOS (faça de forma NATURAL):
- Se não sabe o nome: pergunte de forma casual ("Com quem eu falo?", "Me diz seu nome pra eu te chamar direitinho")
- Se não sabe a loja: pergunte de forma contextual ("Em qual Nutricar você está?" ou "Qual unidade?")
- Se o cliente JÁ disse o nome ou a loja, NÃO pergunte de novo. Use a informação que ele deu.

TOM DE VOZ: Seguro, empático, direto. Como alguém que realmente quer ajudar. O cliente enviou um ÁUDIO — trate como uma conversa pessoal, íntima.

REGRAS DE RESPOSTA PARA ÁUDIO:
1. Máximo 2-3 frases CURTAS (será convertido em áudio TTS).
2. SEM emojis, markdown, asteriscos ou formatação.
3. NÃO mencione PIX/pagamentos — serão enviados por texto separado.
4. Nunca peça CPF. Nunca acuse. Nunca exponha câmeras/segurança.
5. Adapte o tom ao sentimento do cliente: frustrado = ultra-empático, tranquilo = leve e amigável.
6. Varie suas respostas — NUNCA comece duas respostas da mesma forma.

CLASSIFICAÇÃO — responda conforme o caso:
- Reconhecimento facial: oriente sobre iluminação, remover boné/máscara.
- Acesso bloqueado: responda institucionalmente, NUNCA mencione furto.
- Totem: solicite forma de pagamento e data.
- Cobrança: tranquilize, peça detalhes sem assumir erro.
- Produto vencido: agradeça, peça foto.
- Divergência em compra: neutro e técnico, NUNCA use "furto/roubo/crime".
- Sugestão/elogio: agradeça com genuíno carinho.

FRASE INSTITUCIONAL: A Nutricar Brasil utiliza tecnologia, controle de acesso e monitoramento 24 horas para garantir comodidade e segurança a todos.`,
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 250,
        suppress_send: true,
      },
    },
    // Enviar a resposta como áudio via TTS
    {
      id: "multi_audio_tts",
      type: "flowNode",
      position: { x: X - 600, y: 1020 },
      data: {
        nodeType: "action_elevenlabs_tts",
        text: "{{ia_reply}}",
        voice_id: "EXAVITQu4vr4xnSDxMaL",
      },
    },
    {
      id: "multi_audio_tag",
      type: "flowNode",
      position: { x: X - 600, y: 1160 },
      data: { nodeType: "action_add_tag", tag_name: "atendimento-audio" },
    },

    // Áudio COM pagamento → Buscar Produto no catálogo
    {
      id: "multi_audio_search_product",
      type: "flowNode",
      position: { x: X - 100, y: 860 },
      data: {
        nodeType: "action_search_product",
        search_source: "message",
        max_results: 3,
        send_result: false,
        not_found_message: "",
      },
    },
    // Depois da busca → IA qualifica com dados do catálogo
    {
      id: "multi_audio_pix_qualify",
      type: "flowNode",
      position: { x: X - 100, y: 1000 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          `Você é a atendente da Nutricar Brasil. O cliente mencionou um problema de pagamento (possivelmente totem desligado, cartão recusado, etc.).

OBJETIVO: Entender a situação ANTES de enviar dados de PIX. Você precisa saber:
1. O que o cliente estava tentando comprar / qual produto?
2. Qual o valor da compra?
3. Em qual loja/unidade ele está?

REGRAS:
- NÃO envie a chave PIX ainda. Primeiro entenda a situação.
- Se o cliente já disse o produto e valor, confirme os dados antes de prosseguir.
- Se o cliente NÃO disse o que comprou ou o valor, pergunte de forma natural e empática.
- Seja breve (2-3 frases). Tom caloroso e resolutivo.
- NÃO use emojis (será convertido em áudio TTS).
- Exemplo: "Entendi que o totem deu problema. Me conta o que você estava comprando e o valor que apareceu, pra eu te ajudar com o pagamento alternativo?"

Se o nó anterior (Buscar Produto) encontrou resultados, use as variáveis:
- {{produto_nome}}: nome do produto encontrado
- {{produto_preco}}: preço do catálogo
- {{produtos_lista}}: lista completa de resultados
Se {{produto_encontrado}} = "true", confirme o valor do catálogo ao invés de perguntar.`,
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 200,
        suppress_send: true,
      },
    },
    // Enviar qualificação como áudio
    {
      id: "multi_audio_pix_qualify_tts",
      type: "flowNode",
      position: { x: X - 100, y: 1020 },
      data: {
        nodeType: "action_elevenlabs_tts",
        text: "{{ia_reply}}",
        voice_id: "EXAVITQu4vr4xnSDxMaL",
      },
    },
    {
      id: "multi_audio_pix_tag",
      type: "flowNode",
      position: { x: X - 100, y: 1160 },
      data: { nodeType: "action_add_tag", tag_name: "pagamento-qualificacao" },
    },

    // ═══ ROTA 1.5: IMAGEM (identificação de produto) ═══
    {
      id: "multi_check_image",
      type: "flowNode",
      position: { x: X + 700, y: 560 },
      data: { nodeType: "condition_media_type", media_type: "image" },
    },
    // Analisar imagem para identificar produto
    {
      id: "multi_image_analyze",
      type: "flowNode",
      position: { x: X + 700, y: 700 },
      data: {
        nodeType: "action_analyze_image",
        analysis_type: "product_identify",
        custom_prompt: "Este é um produto de mini mercado / conveniência. Identifique marca, nome e tente ler o código de barras se visível.",
        search_catalog: true,
        send_result: true,
      },
    },
    // Buscar produto no catálogo após análise de imagem
    {
      id: "multi_image_search_product",
      type: "flowNode",
      position: { x: X + 700, y: 840 },
      data: {
        nodeType: "action_search_product",
        search_source: "variable",
        search_variable: "produto_identificado",
        max_results: 3,
        send_result: true,
        result_template: "💚 Encontrei no catálogo:\n{{produtos_lista}}",
        not_found_message: "Não encontrei esse produto no nosso catálogo. Pode me dizer o nome ou enviar outra foto?",
      },
    },
    {
      id: "multi_image_tag",
      type: "flowNode",
      position: { x: X + 700, y: 980 },
      data: { nodeType: "action_add_tag", tag_name: "produto-foto" },
    },

    // ═══ ROTA 3: VERIFICAÇÃO DE COMPROVANTE PIX ═══
    // Verifica se a imagem recebida é um comprovante de pagamento
    {
      id: "multi_check_comprovante",
      type: "flowNode",
      position: { x: X + 1050, y: 560 },
      data: {
        nodeType: "condition_contains",
        text: "comprovante,recibo,pix,pagamento,transferência,transferencia,paguei,pago,enviando comprovante,segue comprovante,tá pago,ta pago,fiz o pix,realizei o pagamento",
        case_sensitive: false,
      },
    },
    // Nó de verificação do comprovante PIX
    {
      id: "multi_verify_payment",
      type: "flowNode",
      position: { x: X + 1050, y: 700 },
      data: {
        nodeType: "action_verify_payment",
        expected_pix_key: "financeiro@nutricarbrasil.com.br",
        expected_recipient: "Nutricar Brasil",
        check_value: true,
        max_hours_ago: 24,
        send_result: true,
        auto_tag_fraud: true,
        fraud_tag: "comprovante-suspeito",
      },
    },
    {
      id: "multi_verify_tag_ok",
      type: "flowNode",
      position: { x: X + 1050, y: 840 },
      data: { nodeType: "action_add_tag", tag_name: "pagamento-confirmado" },
    },

    // ═══ ROTA 2: TEXTO (sem áudio, sem imagem) ═══
    // Verificar se texto fala de pagamento
    {
      id: "multi_text_pix_check",
      type: "flowNode",
      position: { x: X + 350, y: 420 },
      data: {
        nodeType: "condition_contains",
        text: "pix,pagamento,pagar,cobrou,cobrança,cobranca,cartão,cartao,débito,debito,crédito,credito,maquininha,não passou,nao passou,dinheiro,troco,totem,desligado,não funciona,nao funciona,sem funcionar,já paguei,ja paguei,já fiz,ja fiz,fiz o pix,fiz o pagamento",
        case_sensitive: false,
      },
    },
    // Verificar se o cliente JÁ PAGOU (para não reenviar chave PIX)
    {
      id: "multi_text_already_paid",
      type: "flowNode",
      position: { x: X + 600, y: 420 },
      data: {
        nodeType: "condition_contains",
        text: "já paguei,ja paguei,já fiz o pagamento,ja fiz o pagamento,fiz o pix,já fiz o pix,ja fiz o pix,já pago,ja pago,tá pago,ta pago,paguei,realizei o pagamento,fiz a transferência,fiz a transferencia,já transferi,ja transferi",
        case_sensitive: false,
      },
    },
    // Resposta para quem já pagou: pedir comprovante
    {
      id: "multi_text_ask_receipt",
      type: "flowNode",
      position: { x: X + 600, y: 560 },
      data: {
        nodeType: "action_send_message",
        message: "Ótimo! 😊 Para confirmar seu pagamento, por favor envie o comprovante do PIX aqui. Assim que recebermos, vamos validar rapidinho! 💚\n\n_Nutricar Brasil - Mini Mercado 24h_",
      },
    },
    {
      id: "multi_text_ask_receipt_tag",
      type: "flowNode",
      position: { x: X + 600, y: 700 },
      data: { nodeType: "action_add_tag", tag_name: "aguardando-comprovante" },
    },
    // Texto COM pagamento (mas NÃO já pagou) → Buscar Produto no catálogo
    {
      id: "multi_text_search_product",
      type: "flowNode",
      position: { x: X + 600, y: 560 },
      data: {
        nodeType: "action_search_product",
        search_source: "message",
        max_results: 3,
        send_result: false,
        not_found_message: "",
      },
    },
    // Depois da busca → IA qualifica com dados do catálogo
    {
      id: "multi_text_pix_qualify",
      type: "flowNode",
      position: { x: X + 600, y: 700 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          `Você é a atendente virtual da Nutricar Brasil 💚. O cliente mencionou um problema de pagamento.

OBJETIVO: Entender a situação ANTES de enviar dados de PIX. Você precisa saber:
1. O que o cliente estava tentando comprar / qual produto? Se ele enviar uma foto, analise a imagem.
2. Qual o valor da compra?
3. Em qual loja/unidade ele está?

REGRAS:
- NÃO envie a chave PIX ainda. Primeiro entenda a situação.
- Se o cliente JÁ disse o produto e valor, confirme: "Então foi [produto] no valor de R$ [valor], certo?"
- Se o cliente NÃO disse o que comprou ou o valor, pergunte de forma natural e empática.
- Se o produto foi identificado por foto (variável {{produto_identificado}}), use essa informação.
- Seja breve (2-3 frases). Tom caloroso e resolutivo.
- Use 1 emoji com moderação.
- Se o cliente já informou a loja, NÃO pergunte de novo.

Se o nó anterior (Buscar Produto) encontrou resultados, use as variáveis:
- {{produto_nome}}: nome do produto encontrado
- {{produto_preco}}: preço do catálogo
- {{produtos_lista}}: lista completa
Se {{produto_encontrado}} = "true", confirme o valor do catálogo ao invés de perguntar.
Se o cliente enviar uma foto do produto, diga que pode enviar para identificarmos.`,
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 250,
      },
    },
    {
      id: "multi_text_pix_tag",
      type: "flowNode",
      position: { x: X + 600, y: 740 },
      data: { nodeType: "action_add_tag", tag_name: "pagamento-qualificacao" },
    },

    // Texto SEM pagamento → IA humanizada
    {
      id: "multi_text_ia",
      type: "flowNode",
      position: { x: X + 100, y: 580 },
      data: {
        nodeType: "action_llm_reply",
        system_prompt:
          `Você é a atendente virtual da Nutricar Brasil — fale como uma pessoa real que se importa com o cliente.

QUEM VOCÊ É: Atendente experiente da Nutricar Brasil, rede de mini mercados autônomos 24h em condomínios e empresas. Você conhece os clientes pelo nome e se preocupa genuinamente com a experiência deles.

LOJAS DA REDE: Nutricar Barra Park, Nutricar Asa Norte, Nutricar Águas Claras, Nutricar Sudoeste, Nutricar Lago Sul, Nutricar Noroeste, Nutricar Park Sul, Nutricar Guará, Nutricar Taguatinga, Nutricar Ceilândia (e novas unidades).

COLETA DE DADOS (faça de forma NATURAL, nunca robótica):
- Se não sabe o nome: "Com quem eu falo? 😊" ou "Me diz seu nome?"
- Se não sabe a loja: "Qual Nutricar você frequenta?" ou contextualize: "Aconteceu em qual unidade?"
- Se o cliente JÁ informou, NÃO pergunte de novo. Use naturalmente na conversa.

TOM DE VOZ: Humano, caloroso mas profissional. Use 1-2 emojis com moderação. Responda como alguém que genuinamente quer ajudar, não como um script.

REGRAS:
1. Respostas CURTAS (2-3 frases máx). Vá direto ao ponto.
2. NUNCA comece duas respostas iguais — varie saudações e despedidas.
3. Adapte o tom: cliente frustrado = empático, cliente tranquilo = leve e amigável.
4. Nunca peça CPF. Nunca acuse. Nunca exponha câmeras/segurança.
5. Se o catálogo de produtos estiver disponível no contexto, use DADOS REAIS de preço.
6. Se não souber o preço, diga que vai verificar e peça foto do código de barras.
7. Sempre pergunte se pode ajudar em mais alguma coisa (mas varie a forma!).

CLASSIFICAÇÃO — identifique e responda conforme o motivo:
- Reconhecimento facial: oriente sobre iluminação, boné, máscara.
- Acesso bloqueado: institucional, NUNCA mencione furto.
- Totem: solicite forma de pagamento e data.
- Cobrança: tranquilize, peça detalhes sem assumir erro.
- Produto vencido: agradeça, peça foto.
- Divergência: neutro e técnico, NUNCA "furto/roubo/crime".
- Sugestão/elogio: agradeça com genuíno carinho.
- Não resolvível: encaminhe para equipe especializada.

FRASE INSTITUCIONAL: A Nutricar Brasil utiliza tecnologia, controle de acesso e monitoramento 24 horas para garantir comodidade e segurança a todos.`,
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: 300,
      },
    },
    {
      id: "multi_text_tag",
      type: "flowNode",
      position: { x: X + 100, y: 740 },
      data: { nodeType: "action_add_tag", tag_name: "atendimento-texto" },
    },
    // Classificar intenção para registrar ocorrência automática
    {
      id: "multi_text_intent",
      type: "flowNode",
      position: { x: X + 100, y: 880 },
      data: {
        nodeType: "condition_intent_classifier",
        intents: "reclamação, sugestão, elogio, dúvida, outro",
        confidence_threshold: 50,
        custom_prompt: "Classifique se a mensagem é uma reclamação, sugestão, elogio, dúvida ou outro tipo de feedback. Se for saudação simples, classifique como 'outro'.",
      },
    },
    // ═══ NÓ ÚNICO DE OCORRÊNCIA (final do fluxo) ═══
    // Registra ocorrência apenas uma vez, ao final de QUALQUER rota
    {
      id: "multi_occ_final",
      type: "flowNode",
      position: { x: X, y: 1160 },
      data: {
        nodeType: "action_register_occurrence",
        occurrence_type: "reclamacao",
        store_name: "Não informada",
        priority: "normal",
      },
    },
  ];

  const edges: Edge[] = [
    // Trigger → Welcome → Collect
    makeEdge("trigger_msg_multi", "multi_welcome_media"),
    makeEdge("multi_welcome_media", "multi_collect"),

    // Collect → Check jurídico PRIMEIRO
    makeEdge("multi_collect", "multi_check_juridico"),
    // Jurídico SIM → escalonamento → ocorrência final
    makeEdge("multi_check_juridico", "multi_juridico_msg", "yes"),
    makeEdge("multi_juridico_msg", "multi_juridico_tag"),
    makeEdge("multi_juridico_tag", "multi_juridico_score"),
    makeEdge("multi_juridico_score", "multi_occ_final"),
    // Jurídico NÃO → segue fluxo normal (check áudio)
    makeEdge("multi_check_juridico", "multi_check_audio", "no"),

    // ── Rota Áudio ──
    makeEdge("multi_check_audio", "multi_transcribe", "yes"),
    makeEdge("multi_transcribe", "multi_audio_pix_check"),
    // Áudio sem pagamento → IA → TTS → tag → ocorrência final
    makeEdge("multi_audio_pix_check", "multi_audio_ia", "no"),
    makeEdge("multi_audio_ia", "multi_audio_tts"),
    makeEdge("multi_audio_tts", "multi_audio_tag"),
    makeEdge("multi_audio_tag", "multi_occ_final"),
    // Áudio com pagamento → buscar produto → IA qualifica → TTS → tag
    makeEdge("multi_audio_pix_check", "multi_audio_search_product", "yes"),
    makeEdge("multi_audio_search_product", "multi_audio_pix_qualify"),
    makeEdge("multi_audio_pix_qualify", "multi_audio_pix_qualify_tts"),
    makeEdge("multi_audio_pix_qualify_tts", "multi_audio_pix_tag"),

    // ── Rota Imagem (se não é áudio, verificar se é imagem) ──
    makeEdge("multi_check_audio", "multi_check_image", "no"),
    // Imagem SIM → verificar se menciona comprovante
    makeEdge("multi_check_image", "multi_check_comprovante", "yes"),
    // Comprovante SIM → verificar pagamento → tag ok → ocorrência final
    makeEdge("multi_check_comprovante", "multi_verify_payment", "yes"),
    makeEdge("multi_verify_payment", "multi_verify_tag_ok"),
    makeEdge("multi_verify_tag_ok", "multi_occ_final"),
    // Comprovante NÃO → analisar produto → buscar catálogo → tag → ocorrência final
    makeEdge("multi_check_comprovante", "multi_image_analyze", "no"),
    makeEdge("multi_image_analyze", "multi_image_search_product"),
    makeEdge("multi_image_search_product", "multi_image_tag"),
    makeEdge("multi_image_tag", "multi_occ_final"),
    // Imagem NÃO → rota texto (pagamento ou IA)
    makeEdge("multi_check_image", "multi_text_pix_check", "no"),
    // Texto com pagamento → verificar se JÁ PAGOU
    makeEdge("multi_text_pix_check", "multi_text_already_paid", "yes"),
    // Já pagou SIM → pedir comprovante → tag → ocorrência final
    makeEdge("multi_text_already_paid", "multi_text_ask_receipt", "yes"),
    makeEdge("multi_text_ask_receipt", "multi_text_ask_receipt_tag"),
    makeEdge("multi_text_ask_receipt_tag", "multi_occ_final"),
    // Já pagou NÃO → buscar produto → IA qualifica → tag (fluxo normal)
    makeEdge("multi_text_already_paid", "multi_text_search_product", "no"),
    makeEdge("multi_text_search_product", "multi_text_pix_qualify"),
    makeEdge("multi_text_pix_qualify", "multi_text_pix_tag"),
    // Texto sem pagamento → IA → tag → classificar intenção → ocorrência final
    makeEdge("multi_text_pix_check", "multi_text_ia", "no"),
    makeEdge("multi_text_ia", "multi_text_tag"),
    makeEdge("multi_text_tag", "multi_text_intent"),
    // Intenção classificada → converge para ocorrência final (ambos os caminhos)
    makeEdge("multi_text_intent", "multi_occ_final", "yes"),
    makeEdge("multi_text_intent", "multi_occ_final", "no"),
  ];

  return {
    id: "atendimento_multimodal",
    name: "Nutricar Brasil — Atendimento Multimodal",
    description: "Atendente virtual humanizado: responde áudios com áudio, envia PIX interativo para pagamentos e solicita comprovante",
    emoji: "💚",
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
