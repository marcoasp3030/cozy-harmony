
-- Helper function: check if current user is an attendant of a given owner
CREATE OR REPLACE FUNCTION public.is_attendant_of(_owner_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.attendant_supervisors
    WHERE attendant_user_id = auth.uid()
      AND supervisor_user_id = _owner_user_id
  )
$$;

-- Allow attendants to SELECT contacts of their supervisor
CREATE POLICY "Attendants can view supervisor contacts"
  ON public.contacts FOR SELECT
  TO authenticated
  USING (is_attendant_of(user_id));

-- Allow attendants to UPDATE contacts of their supervisor
CREATE POLICY "Attendants can update supervisor contacts"
  ON public.contacts FOR UPDATE
  TO authenticated
  USING (is_attendant_of(user_id));

-- Allow attendants to SELECT conversations of their supervisor
CREATE POLICY "Attendants can view supervisor conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (is_attendant_of(user_id));

-- Allow attendants to UPDATE conversations of their supervisor (assign, notes, etc.)
CREATE POLICY "Attendants can update supervisor conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (is_attendant_of(user_id));

-- Allow attendants to SELECT messages of their supervisor
CREATE POLICY "Attendants can view supervisor messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (is_attendant_of(user_id));

-- Allow attendants to INSERT messages (to reply on behalf of supervisor)
CREATE POLICY "Attendants can insert supervisor messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (is_attendant_of(user_id));

-- Allow attendants to view supervisor's funnels
CREATE POLICY "Attendants can view supervisor funnels"
  ON public.funnels FOR SELECT
  TO authenticated
  USING (is_attendant_of(created_by));

-- Allow attendants to view supervisor's funnel stages
CREATE POLICY "Attendants can view supervisor funnel_stages"
  ON public.funnel_stages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.funnels
      WHERE funnels.id = funnel_stages.funnel_id
        AND is_attendant_of(funnels.created_by)
    )
  );

-- Allow attendants to view supervisor's tags
CREATE POLICY "Attendants can view supervisor tags"
  ON public.tags FOR SELECT
  TO authenticated
  USING (is_attendant_of(created_by));
