-- =============================================================================
-- Background schedule (runs inside Supabase for free with pg_cron + pg_net)
--
-- 1. Deploy the app first (e.g. to Vercel) so you know its URL.
-- 2. Replace the two placeholder values below, then run this whole file once
--    in the Supabase SQL editor.
-- 3. Check it with:  select * from cron.job;
--    and history:    select * from cron.job_run_details order by start_time desc limit 20;
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the app URL and cron secret in Supabase Vault (encrypted at rest).
-- Re-running is safe: existing secrets are updated in place.
do $$
declare
  v_url text := 'https://YOUR-APP.vercel.app';        -- <-- your deployed URL, no trailing slash
  v_secret text := 'PASTE_THE_SAME_VALUE_AS_CRON_SECRET'; -- <-- must match CRON_SECRET env var
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'productivize_app_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'productivize_app_url');
  else
    perform vault.update_secret(v_id, v_url);
  end if;

  select id into v_id from vault.secrets where name = 'productivize_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'productivize_cron_secret');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end;
$$;

create or replace function public.productivize_call(p_path text)
returns bigint
language sql
security definer
set search_path = public
as $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'productivize_app_url') || p_path,
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'productivize_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
$$;

revoke all on function public.productivize_call(text) from public, anon, authenticated;

-- Remove old schedules with the same names (safe if they don't exist).
do $$
begin
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('productivize-tick', 'productivize-jobs');
end;
$$;

-- Reminders, end-of-day carry-forward prompts, learning nudges, digests: every 5 minutes.
select cron.schedule('productivize-tick', '*/5 * * * *', $$ select public.productivize_call('/api/cron/tick') $$);

-- Job search: every hour at minute 7.
select cron.schedule('productivize-jobs', '7 * * * *', $$ select public.productivize_call('/api/cron/jobs') $$);
