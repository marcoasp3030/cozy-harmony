
-- Enable pg_trgm extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for fast search
CREATE INDEX idx_products_name_trgm ON public.products USING GIN (name gin_trgm_ops);
CREATE INDEX idx_products_barcode ON public.products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_user_id ON public.products (user_id);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- RLS policy: users manage own products
CREATE POLICY "Users manage own products"
ON public.products
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function for fuzzy product search
CREATE OR REPLACE FUNCTION public.search_products(
  _user_id UUID,
  _query TEXT,
  _limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  barcode TEXT,
  price NUMERIC,
  category TEXT,
  similarity REAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.barcode,
    p.price,
    p.category,
    similarity(p.name, _query) AS similarity
  FROM public.products p
  WHERE p.user_id = _user_id
    AND p.is_active = true
    AND (
      p.name % _query
      OR p.name ILIKE '%' || _query || '%'
      OR p.barcode = _query
    )
  ORDER BY
    CASE WHEN p.barcode = _query THEN 0 ELSE 1 END,
    similarity(p.name, _query) DESC
  LIMIT _limit;
$$;
