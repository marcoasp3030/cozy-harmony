
-- Update trigger to handle service role (edge functions) where auth.uid() is null
-- In that case, derive org_id from user_id column if present
CREATE OR REPLACE FUNCTION public.set_org_id_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    -- Try auth.uid() first (client-side inserts)
    IF auth.uid() IS NOT NULL THEN
      NEW.org_id := get_user_org_id(auth.uid());
    END IF;
    -- If still null and table has user_id, derive from that
    IF NEW.org_id IS NULL AND TG_TABLE_NAME IN ('contacts','conversations','messages','campaigns','automations','automation_logs','templates','funnels','scoring_rules','tags','occurrences','occurrence_history','whatsapp_instances','settings','products','knowledge_categories','ai_feedback') THEN
      BEGIN
        NEW.org_id := get_user_org_id(NEW.user_id);
      EXCEPTION WHEN OTHERS THEN
        NULL; -- column may not exist or be null
      END;
    END IF;
    -- For tables using created_by instead of user_id
    IF NEW.org_id IS NULL AND TG_TABLE_NAME IN ('campaigns','automations','templates','funnels','occurrences','knowledge_categories') THEN
      BEGIN
        NEW.org_id := get_user_org_id(NEW.created_by);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
