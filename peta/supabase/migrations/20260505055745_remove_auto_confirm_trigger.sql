-- Drop the BEFORE INSERT trigger since email confirmation is disabled at project level
DROP TRIGGER IF EXISTS auto_confirm_users_trigger ON auth.users;
DROP FUNCTION IF EXISTS auto_confirm_user();

-- Make sure handle_new_user() doesn't try to update confirmed_at
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'army'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
