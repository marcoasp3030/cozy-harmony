
-- ============================================================
-- FIX: Instance-based tenant isolation via user_id
-- ============================================================

-- 1. Add user_id to tables that need it
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

-- 2. Set DEFAULT auth.uid() on existing created_by columns
ALTER TABLE campaigns ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE automations ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE templates ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE tags ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE funnels ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE occurrences ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 3. Backfill existing data with first user
DO $$
DECLARE
  first_user_id UUID;
BEGIN
  SELECT user_id INTO first_user_id FROM profiles ORDER BY created_at ASC LIMIT 1;
  IF first_user_id IS NOT NULL THEN
    UPDATE contacts SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE conversations SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE messages SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE campaigns SET created_by = first_user_id WHERE created_by IS NULL;
    UPDATE automations SET created_by = first_user_id WHERE created_by IS NULL;
    UPDATE templates SET created_by = first_user_id WHERE created_by IS NULL;
    UPDATE tags SET created_by = first_user_id WHERE created_by IS NULL;
    UPDATE funnels SET created_by = first_user_id WHERE created_by IS NULL;
    UPDATE occurrences SET created_by = first_user_id WHERE created_by IS NULL;
  END IF;
END $$;

-- 4. Drop all old permissive policies
DROP POLICY IF EXISTS "Authenticated users can manage contacts" ON contacts;
DROP POLICY IF EXISTS "Authenticated users can manage conversations" ON conversations;
DROP POLICY IF EXISTS "Authenticated users can manage messages" ON messages;
DROP POLICY IF EXISTS "Authenticated users can manage tags" ON tags;
DROP POLICY IF EXISTS "Authenticated users can manage contact_tags" ON contact_tags;
DROP POLICY IF EXISTS "Authenticated users can manage templates" ON templates;
DROP POLICY IF EXISTS "Authenticated users can manage campaigns" ON campaigns;
DROP POLICY IF EXISTS "Authenticated users can manage campaign_contacts" ON campaign_contacts;
DROP POLICY IF EXISTS "Authenticated users can manage automations" ON automations;
DROP POLICY IF EXISTS "Authenticated users can manage automation_logs" ON automations;
DROP POLICY IF EXISTS "Authenticated users can manage automation_logs" ON automation_logs;
DROP POLICY IF EXISTS "Authenticated users can manage funnels" ON funnels;
DROP POLICY IF EXISTS "Authenticated users can manage funnel_stages" ON funnel_stages;
DROP POLICY IF EXISTS "Authenticated users can manage scoring_rules" ON scoring_rules;
DROP POLICY IF EXISTS "Authenticated users can manage occurrences" ON occurrences;
DROP POLICY IF EXISTS "Authenticated users can manage occurrence_history" ON occurrence_history;

-- 5. Create scoped RLS policies

-- contacts: user_id scoped
CREATE POLICY "Users manage own contacts" ON contacts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- conversations: user_id scoped
CREATE POLICY "Users manage own conversations" ON conversations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- messages: user_id scoped
CREATE POLICY "Users manage own messages" ON messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- campaigns: created_by scoped
CREATE POLICY "Users manage own campaigns" ON campaigns FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- campaign_contacts: scoped through campaigns
CREATE POLICY "Users manage own campaign_contacts" ON campaign_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns WHERE id = campaign_contacts.campaign_id AND created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns WHERE id = campaign_contacts.campaign_id AND created_by = auth.uid()));

-- templates: created_by scoped
CREATE POLICY "Users manage own templates" ON templates FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- tags: created_by scoped
CREATE POLICY "Users manage own tags" ON tags FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- contact_tags: scoped through contacts
CREATE POLICY "Users manage own contact_tags" ON contact_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM contacts WHERE id = contact_tags.contact_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM contacts WHERE id = contact_tags.contact_id AND user_id = auth.uid()));

-- automations: created_by scoped
CREATE POLICY "Users manage own automations" ON automations FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- automation_logs: scoped through automations
CREATE POLICY "Users manage own automation_logs" ON automation_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM automations WHERE id = automation_logs.automation_id AND created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM automations WHERE id = automation_logs.automation_id AND created_by = auth.uid()));

-- funnels: created_by scoped
CREATE POLICY "Users manage own funnels" ON funnels FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- funnel_stages: scoped through funnels
CREATE POLICY "Users manage own funnel_stages" ON funnel_stages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM funnels WHERE id = funnel_stages.funnel_id AND created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM funnels WHERE id = funnel_stages.funnel_id AND created_by = auth.uid()));

-- scoring_rules: scoped through funnels
CREATE POLICY "Users manage own scoring_rules" ON scoring_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM funnels WHERE id = scoring_rules.funnel_id AND created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM funnels WHERE id = scoring_rules.funnel_id AND created_by = auth.uid()));

-- occurrences: created_by scoped
CREATE POLICY "Users manage own occurrences" ON occurrences FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- occurrence_history: scoped through occurrences
CREATE POLICY "Users manage own occurrence_history" ON occurrence_history FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM occurrences WHERE id = occurrence_history.occurrence_id AND created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM occurrences WHERE id = occurrence_history.occurrence_id AND created_by = auth.uid()));
