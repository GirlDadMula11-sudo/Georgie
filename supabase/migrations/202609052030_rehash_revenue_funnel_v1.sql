-- Durable, service-role-only funnel telemetry for Georgie rehash.
-- Tracks secure-link opens and upload lifecycle without exposing bank data.

create table if not exists public.georgie_recovery_funnel_events (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.georgie_recovery_upload_tokens(id) on delete cascade,
  applicant_id text not null,
  episode_id text not null,
  event_type text not null check (event_type in (
    'secure_link_opened',
    'upload_attempted',
    'upload_rejected',
    'statement_verified',
    'package_complete',
    'prism_handoff'
  )),
  event_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists georgie_recovery_funnel_episode_idx
  on public.georgie_recovery_funnel_events(episode_id, created_at desc);
create index if not exists georgie_recovery_funnel_type_idx
  on public.georgie_recovery_funnel_events(event_type, created_at desc);

alter table public.georgie_recovery_funnel_events enable row level security;
revoke all on table public.georgie_recovery_funnel_events from public, anon, authenticated;
grant select, insert on table public.georgie_recovery_funnel_events to service_role;

create or replace function public.georgie_record_recovery_funnel_event_v1(
  p_token_hash text,
  p_event_type text,
  p_event_key text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  token_row public.georgie_recovery_upload_tokens;
  event_row public.georgie_recovery_funnel_events;
begin
  if p_event_type not in (
    'secure_link_opened',
    'upload_attempted',
    'upload_rejected',
    'statement_verified',
    'package_complete',
    'prism_handoff'
  ) then
    raise exception 'RECOVERY_FUNNEL_EVENT_UNSUPPORTED';
  end if;
  if coalesce(p_event_key,'')='' then
    raise exception 'RECOVERY_FUNNEL_EVENT_KEY_REQUIRED';
  end if;

  select * into token_row
  from public.georgie_recovery_upload_tokens
  where token_hash=p_token_hash
    and revoked_at is null
    and expires_at>now();

  if token_row.id is null then
    raise exception 'RECOVERY_FUNNEL_TOKEN_INVALID';
  end if;

  insert into public.georgie_recovery_funnel_events(
    token_id, applicant_id, episode_id, event_type, event_key, metadata
  ) values (
    token_row.id, token_row.applicant_id, token_row.episode_id,
    p_event_type, p_event_key, coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(event_key) do nothing
  returning * into event_row;

  if event_row.id is null then
    select * into event_row
    from public.georgie_recovery_funnel_events
    where event_key=p_event_key;
  end if;

  return jsonb_build_object(
    'ok',true,
    'eventId',event_row.id,
    'eventType',event_row.event_type,
    'episodeId',event_row.episode_id,
    'createdAt',event_row.created_at
  );
end $$;

create or replace function public.georgie_rehash_funnel_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  with event_counts as (
    select
      count(*) filter (where event_type='secure_link_opened')::int as secure_link_open_events,
      count(distinct episode_id) filter (where event_type='secure_link_opened')::int as secure_link_open_merchants,
      count(*) filter (where event_type='upload_attempted')::int as upload_attempt_events,
      count(distinct episode_id) filter (where event_type='upload_attempted')::int as merchants_attempted_upload,
      count(*) filter (where event_type='upload_rejected')::int as upload_rejections,
      count(*) filter (where event_type='statement_verified')::int as statements_verified,
      count(distinct episode_id) filter (where event_type='statement_verified')::int as merchants_with_verified_statement,
      count(distinct episode_id) filter (where event_type='package_complete')::int as packages_complete,
      count(distinct episode_id) filter (where event_type='prism_handoff')::int as prism_handoffs
    from public.georgie_recovery_funnel_events
  ), dispatch_counts as (
    select
      count(*) filter (where status='delivered')::int as delivered,
      count(*) filter (where status='provider_accepted')::int as provider_accepted,
      count(*) filter (where status='held')::int as held,
      count(*) filter (where status='suppressed')::int as suppressed,
      count(*) filter (where status='cancelled')::int as cancelled
    from public.georgie_rehash_email_dispatch
  )
  select jsonb_build_object(
    'contract','georgie.rehash-revenue-funnel.v1',
    'generatedAt',now(),
    'email',jsonb_build_object(
      'delivered',d.delivered,
      'providerAccepted',d.provider_accepted,
      'held',d.held,
      'suppressed',d.suppressed,
      'cancelled',d.cancelled
    ),
    'engagement',jsonb_build_object(
      'secureLinkOpenEvents',e.secure_link_open_events,
      'secureLinkOpenMerchants',e.secure_link_open_merchants,
      'uploadAttemptEvents',e.upload_attempt_events,
      'merchantsAttemptedUpload',e.merchants_attempted_upload,
      'uploadRejections',e.upload_rejections,
      'statementsVerified',e.statements_verified,
      'merchantsWithVerifiedStatement',e.merchants_with_verified_statement,
      'packagesComplete',e.packages_complete,
      'prismHandoffs',e.prism_handoffs
    ),
    'conversion',jsonb_build_object(
      'deliveredToOpenPct',case when d.delivered>0 then round((100.0*e.secure_link_open_merchants/d.delivered)::numeric,2) else null end,
      'openToUploadPct',case when e.secure_link_open_merchants>0 then round((100.0*e.merchants_attempted_upload/e.secure_link_open_merchants)::numeric,2) else null end,
      'uploadToCompletePct',case when e.merchants_attempted_upload>0 then round((100.0*e.packages_complete/e.merchants_attempted_upload)::numeric,2) else null end
    )
  )
  from event_counts e cross join dispatch_counts d
$$;

revoke all on function public.georgie_record_recovery_funnel_event_v1(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.georgie_record_recovery_funnel_event_v1(text,text,text,jsonb) to service_role;

revoke all on function public.georgie_rehash_funnel_v1() from public,anon,authenticated;
grant execute on function public.georgie_rehash_funnel_v1() to service_role;
