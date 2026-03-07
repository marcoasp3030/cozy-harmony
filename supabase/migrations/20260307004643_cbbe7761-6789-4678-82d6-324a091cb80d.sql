
-- Auto-set org_id on insert via trigger for all org-scoped tables
CREATE OR REPLACE FUNCTION public.set_org_id_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := get_user_org_id(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

-- Apply trigger to all org-scoped tables
CREATE TRIGGER set_contacts_org_id BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_conversations_org_id BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_messages_org_id BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_campaigns_org_id BEFORE INSERT ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_campaign_contacts_org_id BEFORE INSERT ON public.campaign_contacts
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_automations_org_id BEFORE INSERT ON public.automations
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_automation_logs_org_id BEFORE INSERT ON public.automation_logs
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_templates_org_id BEFORE INSERT ON public.templates
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_funnels_org_id BEFORE INSERT ON public.funnels
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_funnel_stages_org_id BEFORE INSERT ON public.funnel_stages
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_scoring_rules_org_id BEFORE INSERT ON public.scoring_rules
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_tags_org_id BEFORE INSERT ON public.tags
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_contact_tags_org_id BEFORE INSERT ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_occurrences_org_id BEFORE INSERT ON public.occurrences
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_occurrence_history_org_id BEFORE INSERT ON public.occurrence_history
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_whatsapp_instances_org_id BEFORE INSERT ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_settings_org_id BEFORE INSERT ON public.settings
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_products_org_id BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_knowledge_categories_org_id BEFORE INSERT ON public.knowledge_categories
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_knowledge_articles_org_id BEFORE INSERT ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();

CREATE TRIGGER set_ai_feedback_org_id BEFORE INSERT ON public.ai_feedback
  FOR EACH ROW EXECUTE FUNCTION set_org_id_on_insert();
