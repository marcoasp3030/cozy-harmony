CREATE OR REPLACE FUNCTION public.increment_kb_hit_count(_article_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.knowledge_articles
  SET hit_count = hit_count + 1
  WHERE id = _article_id;
$$;