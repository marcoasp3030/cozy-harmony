
-- =============================================
-- UPDATE RLS POLICIES FOR ORG ISOLATION
-- =============================================

-- Helper: check org_id matches user's org OR user is platform admin
-- This pattern is used across all tables

-- CONTACTS: Drop old policies, create org-based ones
DROP POLICY IF EXISTS "Users manage own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Attendants can view supervisor contacts" ON public.contacts;
DROP POLICY IF EXISTS "Attendants can update supervisor contacts" ON public.contacts;

CREATE POLICY "Platform admins can manage all contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- CONVERSATIONS
DROP POLICY IF EXISTS "Users manage own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Attendants can view supervisor conversations" ON public.conversations;
DROP POLICY IF EXISTS "Attendants can update supervisor conversations" ON public.conversations;

CREATE POLICY "Platform admins can manage all conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- MESSAGES
DROP POLICY IF EXISTS "Users manage own messages" ON public.messages;
DROP POLICY IF EXISTS "Attendants can view supervisor messages" ON public.messages;
DROP POLICY IF EXISTS "Attendants can insert supervisor messages" ON public.messages;

CREATE POLICY "Platform admins can manage all messages"
  ON public.messages FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org messages"
  ON public.messages FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- CAMPAIGNS
DROP POLICY IF EXISTS "Users manage own campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Supervisors can view all campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Supervisors can manage all campaigns" ON public.campaigns;

CREATE POLICY "Platform admins can manage all campaigns"
  ON public.campaigns FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org campaigns"
  ON public.campaigns FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- CAMPAIGN_CONTACTS
DROP POLICY IF EXISTS "Users manage own campaign_contacts" ON public.campaign_contacts;
DROP POLICY IF EXISTS "Supervisors can view all campaign_contacts" ON public.campaign_contacts;
DROP POLICY IF EXISTS "Supervisors can manage all campaign_contacts" ON public.campaign_contacts;

CREATE POLICY "Platform admins can manage all campaign_contacts"
  ON public.campaign_contacts FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org campaign_contacts"
  ON public.campaign_contacts FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- AUTOMATIONS
DROP POLICY IF EXISTS "Users manage own automations" ON public.automations;

CREATE POLICY "Platform admins can manage all automations"
  ON public.automations FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org automations"
  ON public.automations FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- AUTOMATION_LOGS
DROP POLICY IF EXISTS "Users manage own automation_logs" ON public.automation_logs;

CREATE POLICY "Platform admins can manage all automation_logs"
  ON public.automation_logs FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org automation_logs"
  ON public.automation_logs FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- TEMPLATES
DROP POLICY IF EXISTS "Users manage own templates" ON public.templates;

CREATE POLICY "Platform admins can manage all templates"
  ON public.templates FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org templates"
  ON public.templates FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- FUNNELS
DROP POLICY IF EXISTS "Users manage own funnels" ON public.funnels;
DROP POLICY IF EXISTS "Attendants can view supervisor funnels" ON public.funnels;

CREATE POLICY "Platform admins can manage all funnels"
  ON public.funnels FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org funnels"
  ON public.funnels FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- FUNNEL_STAGES
DROP POLICY IF EXISTS "Users manage own funnel_stages" ON public.funnel_stages;
DROP POLICY IF EXISTS "Attendants can view supervisor funnel_stages" ON public.funnel_stages;

CREATE POLICY "Platform admins can manage all funnel_stages"
  ON public.funnel_stages FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org funnel_stages"
  ON public.funnel_stages FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- SCORING_RULES
DROP POLICY IF EXISTS "Users manage own scoring_rules" ON public.scoring_rules;

CREATE POLICY "Platform admins can manage all scoring_rules"
  ON public.scoring_rules FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org scoring_rules"
  ON public.scoring_rules FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- TAGS
DROP POLICY IF EXISTS "Users manage own tags" ON public.tags;
DROP POLICY IF EXISTS "Attendants can view supervisor tags" ON public.tags;

CREATE POLICY "Platform admins can manage all tags"
  ON public.tags FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org tags"
  ON public.tags FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- CONTACT_TAGS
DROP POLICY IF EXISTS "Users manage own contact_tags" ON public.contact_tags;

CREATE POLICY "Platform admins can manage all contact_tags"
  ON public.contact_tags FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org contact_tags"
  ON public.contact_tags FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- OCCURRENCES
DROP POLICY IF EXISTS "Users manage own occurrences" ON public.occurrences;

CREATE POLICY "Platform admins can manage all occurrences"
  ON public.occurrences FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org occurrences"
  ON public.occurrences FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- OCCURRENCE_HISTORY
DROP POLICY IF EXISTS "Users manage own occurrence_history" ON public.occurrence_history;

CREATE POLICY "Platform admins can manage all occurrence_history"
  ON public.occurrence_history FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org occurrence_history"
  ON public.occurrence_history FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- WHATSAPP_INSTANCES
DROP POLICY IF EXISTS "Users can manage own instances" ON public.whatsapp_instances;

CREATE POLICY "Platform admins can manage all instances"
  ON public.whatsapp_instances FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org instances"
  ON public.whatsapp_instances FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- SETTINGS
DROP POLICY IF EXISTS "Users can manage own settings" ON public.settings;

CREATE POLICY "Platform admins can manage all settings"
  ON public.settings FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org settings"
  ON public.settings FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- PRODUCTS
DROP POLICY IF EXISTS "Users manage own products" ON public.products;

CREATE POLICY "Platform admins can manage all products"
  ON public.products FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org products"
  ON public.products FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- KNOWLEDGE_CATEGORIES
DROP POLICY IF EXISTS "Users manage own knowledge_categories" ON public.knowledge_categories;

CREATE POLICY "Platform admins can manage all knowledge_categories"
  ON public.knowledge_categories FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org knowledge_categories"
  ON public.knowledge_categories FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- KNOWLEDGE_ARTICLES
DROP POLICY IF EXISTS "Users manage own knowledge_articles" ON public.knowledge_articles;

CREATE POLICY "Platform admins can manage all knowledge_articles"
  ON public.knowledge_articles FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org knowledge_articles"
  ON public.knowledge_articles FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- AI_FEEDBACK
DROP POLICY IF EXISTS "Users manage own ai_feedback" ON public.ai_feedback;

CREATE POLICY "Platform admins can manage all ai_feedback"
  ON public.ai_feedback FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members manage org ai_feedback"
  ON public.ai_feedback FOR ALL TO authenticated
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));
