
-- Supervisors can view all campaigns
CREATE POLICY "Supervisors can view all campaigns"
  ON public.campaigns FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role));

-- Supervisors can view all campaign_contacts
CREATE POLICY "Supervisors can view all campaign_contacts"
  ON public.campaign_contacts FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role));
