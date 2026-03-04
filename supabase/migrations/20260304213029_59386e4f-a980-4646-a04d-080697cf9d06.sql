
UPDATE automations
SET flow = jsonb_set(
  jsonb_set(
    flow::jsonb,
    '{nodes}',
    (flow::jsonb->'nodes') || '[{"id":"multi_notify_group","type":"flowNode","position":{"x":400,"y":1310},"data":{"nodeType":"action_notify_group","group_id":"120363408395105824@g.us","mention_numbers":"5511957769899","message_template":"🚨 *Alerta de Ocorrência*\n\n📍 Loja: {{loja}}\n📝 {{descricao}}\n👤 Contato: {{nome}}\n📞 {{phone}}\n🏷️ Tipo: {{tipo_ocorrencia}}","only_types":"acesso_bloqueado, problema_pagamento"}}]'::jsonb
  ),
  '{edges}',
  (flow::jsonb->'edges') || '[{"id":"e_multi_occ_final_multi_notify_group","source":"multi_occ_final","target":"multi_notify_group","animated":true,"style":{"strokeWidth":2,"stroke":"hsl(var(--primary))"},"markerEnd":{"type":"arrowclosed","color":"hsl(var(--primary))"}}]'::jsonb
),
updated_at = now()
WHERE id = '5722e9cc-e467-4b0a-b964-b36f4a08abe2'
AND NOT (flow::text LIKE '%multi_notify_group%');
