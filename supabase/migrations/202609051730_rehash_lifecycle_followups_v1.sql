-- State-aware, fail-closed lifecycle follow-up scheduler for Georgie rehash.
-- Reuses the durable recovery intent/audit model; no new exposed tables.

create or replace function public.georgie_schedule_recovery_followups_v1(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  rec record;
  inserted_count int := 0;
  considered_count int := 0;
  sent_count int;
  uploaded_count int;
  last_sent_at timestamptz;
  last_upload_at timestamptz;
  base_payload jsonb;
  requested text[];
  uploaded text[];
  missing text[];
  state text;
  next_attempt int;
  key text;
begin
  for rec in
    select c.*
    from public.georgie_recovery_candidates c
    where not exists (
      select 1 from public.georgie_recovery_suppressions s
      where (s.email=c.email or s.applicant_id=c.applicant_id)
        and (s.expires_at is null or s.expires_at>now())
    )
      and not exists (
        select 1 from public.georgie_recovery_audit a
        where a.deal_id=c.deal_id and a.event_type='reply.received'
      )
    order by c.updated_at asc
    limit least(greatest(p_limit,1),500)
  loop
    considered_count := considered_count + 1;

    select count(*), max(coalesce(i.completed_at,i.created_at))
      into sent_count,last_sent_at
    from public.georgie_recovery_intents i
    where i.deal_id=rec.deal_id
      and i.kind in ('statement_request','statement_followup')
      and i.status='sent';

    if sent_count < 1 or sent_count >= 3 or last_sent_at is null then
      continue;
    end if;

    select i.payload into base_payload
    from public.georgie_recovery_intents i
    where i.deal_id=rec.deal_id
      and i.kind in ('statement_request','statement_followup')
    order by i.created_at desc
    limit 1;

    requested := array(
      select jsonb_array_elements_text(coalesce(base_payload->'missingMonths',base_payload->'requiredMonths','[]'::jsonb))
    );
    if cardinality(requested) is null or cardinality(requested)=0 then
      continue;
    end if;

    select count(distinct u.statement_month), max(u.created_at), coalesce(array_agg(distinct u.statement_month) filter (where u.statement_month is not null),'{}'::text[])
      into uploaded_count,last_upload_at,uploaded
    from public.georgie_recovery_uploads u
    where u.episode_id=rec.deal_id and u.statement_month=any(requested);

    if uploaded_count >= cardinality(requested) then
      continue;
    end if;

    missing := array(select m from unnest(requested) m where not (m=any(uploaded)));
    next_attempt := sent_count + 1;

    if uploaded_count = 1 then
      if last_upload_at is null or last_upload_at > now()-interval '2 days' then continue; end if;
      state := 'partial_upload';
    elsif sent_count = 1 then
      if last_sent_at > now()-interval '5 days' then continue; end if;
      state := 'delivered_no_upload';
    else
      if last_sent_at > now()-interval '7 days' then continue; end if;
      state := 'final_checkin';
    end if;

    key := 'statement-followup:'||rec.deal_id||':'||next_attempt::text||':'||state;
    insert into public.georgie_recovery_intents(
      deal_id,applicant_id,thread_id,kind,idempotency_key,payload,status,available_at
    ) values (
      rec.deal_id,rec.applicant_id,rec.thread_id,'statement_followup',key,
      coalesce(base_payload,rec.payload)||jsonb_build_object(
        'followupState',state,
        'followupAttempt',next_attempt,
        'missingMonths',to_jsonb(missing),
        'lifecycleContract','georgie.rehash-lifecycle.v1'
      ),
      'pending',now()
    ) on conflict(idempotency_key) do nothing;

    if found then inserted_count := inserted_count + 1; end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'contract','georgie.rehash-lifecycle.v1',
    'considered',considered_count,
    'scheduled',inserted_count
  );
end $$;

-- Frequency control must recognize the actual durable sent event names.
create or replace function public.georgie_recovery_suppression(p_intent_id uuid) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select case
    when not exists(select 1 from public.georgie_recovery_intents where id=p_intent_id and status='processing')
      then jsonb_build_object('allowed',false,'reason','intent_state_uncertain')
    when exists(
      select 1
      from public.georgie_recovery_intents i
      join public.georgie_recovery_candidates c on c.deal_id=i.deal_id
      join public.georgie_recovery_suppressions s on (s.email=c.email or s.applicant_id=c.applicant_id)
      where i.id=p_intent_id and (s.expires_at is null or s.expires_at>now())
    ) then jsonb_build_object('allowed',false,'reason','global_suppression')
    when exists(
      select 1
      from public.georgie_recovery_intents i
      join public.georgie_recovery_audit a on a.deal_id=i.deal_id
      where i.id=p_intent_id
        and a.event_type in ('statement_request.sent','statement_followup.sent')
        and a.created_at>now()-interval '2 days'
    ) then jsonb_build_object('allowed',false,'reason','contact_frequency')
    else jsonb_build_object('allowed',true)
  end
$$;

revoke all on function public.georgie_schedule_recovery_followups_v1(int) from public,anon,authenticated;
grant execute on function public.georgie_schedule_recovery_followups_v1(int) to service_role;

revoke all on function public.georgie_recovery_suppression(uuid) from public,anon,authenticated;
grant execute on function public.georgie_recovery_suppression(uuid) to service_role;
