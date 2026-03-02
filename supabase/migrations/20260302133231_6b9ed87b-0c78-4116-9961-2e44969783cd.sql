
-- Fix orphaned contacts (user_id is null) by assigning to the first whatsapp_instances owner
UPDATE public.contacts
SET user_id = (
  SELECT user_id FROM public.whatsapp_instances ORDER BY is_default DESC, created_at ASC LIMIT 1
)
WHERE user_id IS NULL;

-- Fix orphaned conversations
UPDATE public.conversations
SET user_id = (
  SELECT user_id FROM public.whatsapp_instances ORDER BY is_default DESC, created_at ASC LIMIT 1
)
WHERE user_id IS NULL;

-- Fix orphaned messages
UPDATE public.messages
SET user_id = (
  SELECT user_id FROM public.whatsapp_instances ORDER BY is_default DESC, created_at ASC LIMIT 1
)
WHERE user_id IS NULL;
