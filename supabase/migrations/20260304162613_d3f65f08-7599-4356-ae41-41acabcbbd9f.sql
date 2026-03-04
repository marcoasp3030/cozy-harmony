UPDATE automations
SET flow = (
  SELECT jsonb_build_object(
    'nodes', (
      SELECT jsonb_agg(
        CASE
          WHEN (node->>'type') = 'custom' AND (node->'data'->>'nodeType') = 'action_llm_reply'
          THEN jsonb_set(node, '{data,max_tokens}', '"2048"')
          ELSE node
        END
      )
      FROM jsonb_array_elements(flow::jsonb->'nodes') AS node
    ),
    'edges', flow::jsonb->'edges',
    'viewport', flow::jsonb->'viewport'
  )
)
WHERE id = '714c97a8-1053-46ba-9db2-87d88bc0c5ec';
