
CREATE OR REPLACE FUNCTION public.get_admin_uazapi_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT s.value
  FROM public.settings s
  INNER JOIN public.user_roles ur ON ur.user_id = s.user_id AND ur.role = 'admin'
  WHERE s.key = 'uazapi_global'
  LIMIT 1;
$$;
