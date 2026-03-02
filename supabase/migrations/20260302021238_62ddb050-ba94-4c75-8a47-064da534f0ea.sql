
-- =============================================
-- Fix automation_logs: remove USING(true) policy and recreate as PERMISSIVE
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can view automation_logs" ON public.automation_logs;
DROP POLICY IF EXISTS "Users manage own automation_logs" ON public.automation_logs;

CREATE POLICY "Users manage own automation_logs"
  ON public.automation_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM automations WHERE automations.id = automation_logs.automation_id AND automations.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM automations WHERE automations.id = automation_logs.automation_id AND automations.created_by = auth.uid()));

-- =============================================
-- Fix automations
-- =============================================
DROP POLICY IF EXISTS "Users manage own automations" ON public.automations;
CREATE POLICY "Users manage own automations"
  ON public.automations FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================
-- Fix campaign_contacts
-- =============================================
DROP POLICY IF EXISTS "Users manage own campaign_contacts" ON public.campaign_contacts;
CREATE POLICY "Users manage own campaign_contacts"
  ON public.campaign_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_contacts.campaign_id AND campaigns.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_contacts.campaign_id AND campaigns.created_by = auth.uid()));

-- =============================================
-- Fix campaigns
-- =============================================
DROP POLICY IF EXISTS "Users manage own campaigns" ON public.campaigns;
CREATE POLICY "Users manage own campaigns"
  ON public.campaigns FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================
-- Fix contact_tags
-- =============================================
DROP POLICY IF EXISTS "Users manage own contact_tags" ON public.contact_tags;
CREATE POLICY "Users manage own contact_tags"
  ON public.contact_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND contacts.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND contacts.user_id = auth.uid()));

-- =============================================
-- Fix contacts
-- =============================================
DROP POLICY IF EXISTS "Users manage own contacts" ON public.contacts;
CREATE POLICY "Users manage own contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================
-- Fix conversations
-- =============================================
DROP POLICY IF EXISTS "Users manage own conversations" ON public.conversations;
CREATE POLICY "Users manage own conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================
-- Fix funnel_stages
-- =============================================
DROP POLICY IF EXISTS "Users manage own funnel_stages" ON public.funnel_stages;
CREATE POLICY "Users manage own funnel_stages"
  ON public.funnel_stages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM funnels WHERE funnels.id = funnel_stages.funnel_id AND funnels.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM funnels WHERE funnels.id = funnel_stages.funnel_id AND funnels.created_by = auth.uid()));

-- =============================================
-- Fix funnels
-- =============================================
DROP POLICY IF EXISTS "Users manage own funnels" ON public.funnels;
CREATE POLICY "Users manage own funnels"
  ON public.funnels FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================
-- Fix messages
-- =============================================
DROP POLICY IF EXISTS "Users manage own messages" ON public.messages;
CREATE POLICY "Users manage own messages"
  ON public.messages FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================
-- Fix occurrence_history
-- =============================================
DROP POLICY IF EXISTS "Users manage own occurrence_history" ON public.occurrence_history;
CREATE POLICY "Users manage own occurrence_history"
  ON public.occurrence_history FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM occurrences WHERE occurrences.id = occurrence_history.occurrence_id AND occurrences.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM occurrences WHERE occurrences.id = occurrence_history.occurrence_id AND occurrences.created_by = auth.uid()));

-- =============================================
-- Fix occurrences
-- =============================================
DROP POLICY IF EXISTS "Users manage own occurrences" ON public.occurrences;
CREATE POLICY "Users manage own occurrences"
  ON public.occurrences FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================
-- Fix profiles
-- =============================================
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =============================================
-- Fix scoring_rules
-- =============================================
DROP POLICY IF EXISTS "Users manage own scoring_rules" ON public.scoring_rules;
CREATE POLICY "Users manage own scoring_rules"
  ON public.scoring_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM funnels WHERE funnels.id = scoring_rules.funnel_id AND funnels.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM funnels WHERE funnels.id = scoring_rules.funnel_id AND funnels.created_by = auth.uid()));

-- =============================================
-- Fix settings
-- =============================================
DROP POLICY IF EXISTS "Users can manage own settings" ON public.settings;
CREATE POLICY "Users can manage own settings"
  ON public.settings FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================
-- Fix tags
-- =============================================
DROP POLICY IF EXISTS "Users manage own tags" ON public.tags;
CREATE POLICY "Users manage own tags"
  ON public.tags FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================
-- Fix templates
-- =============================================
DROP POLICY IF EXISTS "Users manage own templates" ON public.templates;
CREATE POLICY "Users manage own templates"
  ON public.templates FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================
-- Fix whatsapp_instances
-- =============================================
DROP POLICY IF EXISTS "Users can manage own instances" ON public.whatsapp_instances;
CREATE POLICY "Users can manage own instances"
  ON public.whatsapp_instances FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
