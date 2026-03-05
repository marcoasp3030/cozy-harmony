
ALTER TABLE public.contacts DROP CONSTRAINT contacts_phone_key;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_user_phone_key UNIQUE (user_id, phone);
