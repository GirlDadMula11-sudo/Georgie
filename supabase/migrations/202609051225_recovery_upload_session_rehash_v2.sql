-- Resolve secure rehash upload sessions from either canonical recovery candidates
-- or the production rehash dossier that issued the token. Token scope remains exact.
create or replace function public.georgie_recovery_upload_session_v2(p_token_hash text)
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'status', case when t.revoked_at is not null then 'revoked' when t.expires_at<=now() then 'expired' else 'active' end,
    'firstName', coalesce(c.payload->>'firstName', d.contact->>'first_name', d.contact->>'firstName'),
    'businessName', coalesce(c.payload->>'businessIdentity', d.merchant_name, 'Your business statement request'),
    'requestedMonths', t.requested_months,
    'expiresAt', t.expires_at,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object('month',m,'status',case when u.statement_month is null then 'open' else 'verified' end) order by m)
      from unnest(t.requested_months) m
      left join public.georgie_recovery_uploads u on u.episode_id=t.episode_id and u.statement_month=m
    ), '[]'::jsonb),
    'complete', (select count(distinct statement_month)=cardinality(t.requested_months) from public.georgie_recovery_uploads where episode_id=t.episode_id and statement_month=any(t.requested_months))
  )
  from public.georgie_recovery_upload_tokens t
  left join public.georgie_recovery_candidates c on c.applicant_id=t.applicant_id and c.deal_id=t.episode_id
  left join public.georgie_rehash_email_dispatch q on q.token_id=t.id and q.episode_id=t.episode_id
  left join public.georgie_rehash_merchant_dossiers d on d.id=q.dossier_id and d.merchant_id::text=t.applicant_id
  where t.token_hash=p_token_hash
    and (c.applicant_id is not null or d.id is not null)
  limit 1
$$;
revoke all on function public.georgie_recovery_upload_session_v2(text) from public,anon,authenticated;
grant execute on function public.georgie_recovery_upload_session_v2(text) to service_role;