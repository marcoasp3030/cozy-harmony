
-- Supervisors can manage (INSERT, UPDATE, DELETE) campaigns
CREATE POLICY "Supervisors can manage all campaigns"
  ON public.campaigns FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'supervisor'::app_role));

-- Supervisors can manage campaign_contacts
CREATE POLICY "Supervisors can manage all campaign_contacts"
  ON public.campaign_contacts FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'supervisor'::app_role));
