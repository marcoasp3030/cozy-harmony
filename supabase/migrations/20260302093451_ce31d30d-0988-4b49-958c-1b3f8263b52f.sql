-- Allow admins to delete any profile
CREATE POLICY "Admins can delete all profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));