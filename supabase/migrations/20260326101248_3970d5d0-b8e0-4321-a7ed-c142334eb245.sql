
-- Create GIN trigram index on knowledge_articles for fuzzy search
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_title_trgm ON public.knowledge_articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_content_trgm ON public.knowledge_articles USING gin (content gin_trgm_ops);

-- Function: fuzzy search knowledge articles by text similarity
CREATE OR REPLACE FUNCTION public.search_knowledge_articles(
  _user_id uuid,
  _query text,
  _min_similarity real DEFAULT 0.15,
  _limit integer DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  title text,
  content text,
  category_id uuid,
  tags text[],
  title_similarity real,
  content_similarity real,
  best_similarity real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.id,
    a.title,
    a.content,
    a.category_id,
    a.tags,
    similarity(a.title, _query) AS title_similarity,
    similarity(a.content, _query) AS content_similarity,
    GREATEST(similarity(a.title, _query), similarity(a.content, _query)) AS best_similarity
  FROM public.knowledge_articles a
  INNER JOIN public.knowledge_categories c ON c.id = a.category_id
  WHERE a.is_active = true
    AND c.created_by = _user_id
    AND c.always_inject = false
    AND (
      a.title % _query
      OR a.content % _query
      OR a.title ILIKE '%' || _query || '%'
    )
  ORDER BY GREATEST(similarity(a.title, _query), similarity(a.content, _query)) DESC
  LIMIT _limit;
$$;
