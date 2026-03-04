
UPDATE public.automations 
SET flow = jsonb_set(
  flow,
  '{nodes}',
  (
    SELECT jsonb_agg(
      CASE 
        WHEN node -> 'data' ->> 'nodeType' = 'action_llm_reply' 
        THEN jsonb_set(node, '{data,model}', '"gpt-4o"')
        ELSE node
      END
    )
    FROM jsonb_array_elements(flow -> 'nodes') AS node
  )
),
updated_at = now()
WHERE id = '714c97a8-1053-46ba-9db2-87d88bc0c5ec';
