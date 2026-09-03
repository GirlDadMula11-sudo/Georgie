-- Durable, fail-closed financing recovery slice. Service-role access only.
create table if not exists georgie_recovery_candidates (
  id uuid primary key default gen_random_uuid(), applicant_id text not null, deal_id text not null unique,
  thread_id text not null unique, lane text not null check (lane in ('historical','new')),
  source_application_id text not null unique, email text not null, payload jsonb not null,
  state text not null default 'eligible', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists georgie_recovery_suppressions (
  id uuid primary key default gen_random_uuid(), applicant_id text, email text,
  reason text not null check (reason in ('opt_out','complaint','invalid','bounce','dispute','duplicate','active_deal','recent_contact')),
  evidence_id text not null, source_event_key text not null unique, expires_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists georgie_recovery_intents (
  id uuid primary key default gen_random_uuid(), deal_id text not null references georgie_recovery_candidates(deal_id),
  applicant_id text not null, thread_id text not null, kind text not null,
  idempotency_key text not null unique, payload jsonb not null, status text not null default 'pending',
  attempts int not null default 0 check (attempts <= 3), available_at timestamptz not null default now(),
  lease_token uuid, lease_expires_at timestamptz, provider_evidence jsonb, created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists georgie_recovery_audit (
  id bigserial primary key, deal_id text not null, event_key text unique, event_type text not null,
  evidence_ids text[] not null default '{}', payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists georgie_recovery_intents_claim on georgie_recovery_intents(status,available_at,lease_expires_at);
create index if not exists georgie_recovery_suppressions_identity on georgie_recovery_suppressions(email,applicant_id);
alter table georgie_recovery_candidates enable row level security;
alter table georgie_recovery_suppressions enable row level security;
alter table georgie_recovery_intents enable row level security;
alter table georgie_recovery_audit enable row level security;

create or replace function georgie_recovery_ingest_candidate_v2(p_candidate jsonb, p_intent jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate_row georgie_recovery_candidates; intent_row georgie_recovery_intents; inserted boolean := false;
begin
  if p_candidate->>'canonicalApplicationOnly' <> 'true' or p_candidate->>'rawApplicationCrmWrite' <> 'false'
    or coalesce(p_candidate->>'canonicalDealEvidenceId','') = '' or coalesce(p_candidate->>'consentEvidenceId','') = '' then
    raise exception 'CANONICAL_INTAKE_EVIDENCE_REQUIRED';
  end if;
  insert into georgie_recovery_candidates(applicant_id,deal_id,thread_id,lane,source_application_id,email,payload)
  values(p_candidate->>'applicantId',p_candidate->>'dealId',p_candidate->>'threadId',p_candidate->>'lane',p_candidate->>'sourceApplicationId',lower(p_candidate->>'email'),p_candidate)
  on conflict (source_application_id) do update set updated_at=now()
  where georgie_recovery_candidates.deal_id=excluded.deal_id returning * into candidate_row;
  if candidate_row.id is null then raise exception 'CANONICAL_DEAL_CONFLICT'; end if;
  insert into georgie_recovery_intents(deal_id,applicant_id,thread_id,kind,idempotency_key,payload)
  values(candidate_row.deal_id,candidate_row.applicant_id,candidate_row.thread_id,p_intent->>'kind',p_intent->>'key',candidate_row.payload || p_intent)
  on conflict (idempotency_key) do nothing returning * into intent_row;
  inserted := intent_row.id is not null;
  if not inserted then select * into intent_row from georgie_recovery_intents where idempotency_key=p_intent->>'key'; end if;
  insert into georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload)
  values(candidate_row.deal_id,'intake:'||(p_candidate->>'sourceApplicationId'),'intake.canonical',array(select jsonb_array_elements_text(p_candidate->'evidenceIds')),p_candidate)
  on conflict(event_key) do nothing;
  return jsonb_build_object('candidateId',candidate_row.id,'dealId',candidate_row.deal_id,'intentId',intent_row.id,'intentCreated',inserted,'intentKind',intent_row.kind);
end $$;

create or replace function georgie_recovery_ingest_reply_v2(p_reply jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate_row georgie_recovery_candidates; intent_key text; intent_kind text; intent_row georgie_recovery_intents; inserted boolean := false;
begin
  select * into candidate_row from georgie_recovery_candidates where deal_id=p_reply->>'dealId' and thread_id=p_reply->>'threadId';
  if candidate_row.id is null then raise exception 'EXACT_REPLY_IDENTITY_UNRESOLVED'; end if;
  insert into georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload)
  values(candidate_row.deal_id,p_reply->>'replyKey','reply.received',array(select jsonb_array_elements_text(coalesce(p_reply->'evidenceIds','[]'::jsonb))),p_reply)
  on conflict(event_key) do nothing;
  if not found then
    select * into intent_row from georgie_recovery_intents where idempotency_key in (p_reply->>'prismKey',p_reply->>'closerKey',p_reply->>'acknowledgementKey') limit 1;
    return jsonb_build_object('deduplicated',true,'replyKey',p_reply->>'replyKey','intentId',intent_row.id,'intentCreated',false);
  end if;
  if coalesce(p_reply->>'closerKey','') <> '' then intent_key:=p_reply->>'closerKey'; intent_kind:='closer_handoff';
  elsif coalesce(p_reply->>'prismKey','') <> '' then intent_key:=p_reply->>'prismKey'; intent_kind:='prism_wakeup';
  else intent_key:=p_reply->>'acknowledgementKey'; intent_kind:='acknowledgement'; end if;
  insert into georgie_recovery_intents(deal_id,applicant_id,thread_id,kind,idempotency_key,payload)
  values(candidate_row.deal_id,candidate_row.applicant_id,candidate_row.thread_id,intent_kind,intent_key,candidate_row.payload || p_reply)
  on conflict(idempotency_key) do nothing returning * into intent_row;
  inserted:=intent_row.id is not null;
  if not inserted then select * into intent_row from georgie_recovery_intents where idempotency_key=intent_key; end if;
  return jsonb_build_object('deduplicated',false,'replyKey',p_reply->>'replyKey','intentId',intent_row.id,'intentCreated',inserted,'intentKind',intent_kind);
end $$;

create or replace function georgie_recovery_ingest_suppression_v1(p_event jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare suppression_id uuid; inserted boolean := false;
begin
  insert into georgie_recovery_suppressions(applicant_id,email,reason,evidence_id,source_event_key,expires_at)
  values(nullif(p_event->>'applicantId',''),nullif(lower(p_event->>'email'),''),p_event->>'reason',p_event->>'evidenceId',p_event->>'idempotencyKey',nullif(p_event->>'expiresAt','')::timestamptz)
  on conflict(source_event_key) do nothing returning id into suppression_id;
  inserted:=suppression_id is not null;
  if not inserted then select id into suppression_id from georgie_recovery_suppressions where source_event_key=p_event->>'idempotencyKey'; end if;
  return jsonb_build_object('suppressionId',suppression_id,'created',inserted);
end $$;

create or replace function georgie_claim_recovery_intents(p_limit int default 10,p_lease_seconds int default 60) returns setof georgie_recovery_intents
language plpgsql security definer set search_path=public as $$ begin
  return query update georgie_recovery_intents i set lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,10),300)),attempts=i.attempts+1,status='processing'
  where i.id in (select id from georgie_recovery_intents where status in('pending','retry','processing') and available_at<=now() and (lease_expires_at is null or lease_expires_at<now()) and attempts<3 order by created_at for update skip locked limit least(greatest(p_limit,1),50)) returning i.*;
end $$;

create or replace function georgie_recovery_suppression(p_intent_id uuid) returns jsonb
language sql security definer set search_path=public as $$
  select case
    when not exists(select 1 from georgie_recovery_intents where id=p_intent_id and status='processing') then jsonb_build_object('allowed',false,'reason','intent_state_uncertain')
    when exists(select 1 from georgie_recovery_intents i join georgie_recovery_candidates c on c.deal_id=i.deal_id join georgie_recovery_suppressions s on (s.email=c.email or s.applicant_id=c.applicant_id) where i.id=p_intent_id and (s.expires_at is null or s.expires_at>now())) then jsonb_build_object('allowed',false,'reason','global_suppression')
    when exists(select 1 from georgie_recovery_intents i join georgie_recovery_audit a on a.deal_id=i.deal_id where i.id=p_intent_id and a.event_type='provider.sent' and a.created_at>now()-interval '7 days') then jsonb_build_object('allowed',false,'reason','contact_frequency')
    else jsonb_build_object('allowed',true) end
$$;

create or replace function georgie_complete_recovery_intent(p_id uuid,p_lease uuid,p_status text,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare row georgie_recovery_intents;
begin
  if p_status not in('held','suppressed','failed','blocked','sent','completed','retry') then raise exception 'INVALID_TERMINAL_STATUS'; end if;
  if p_status='sent' and (coalesce(p_evidence->>'messageId','')='' or jsonb_array_length(coalesce(p_evidence->'accepted','[]'))=0 or jsonb_array_length(coalesce(p_evidence->'rejected','[]'))>0 or p_evidence#>>'{sierraReadBack,ok}' <> 'true') then raise exception 'COMPLETE_PROVIDER_AND_SIERRA_RECEIPT_REQUIRED'; end if;
  if p_status='completed' and (coalesce(p_evidence#>>'{receipt,receiptId}','')='' or p_evidence#>>'{receipt,readBack,verified}' <> 'true') then raise exception 'DOWNSTREAM_RECEIPT_READBACK_REQUIRED'; end if;
  update georgie_recovery_intents set status=p_status,provider_evidence=p_evidence,completed_at=case when p_status='retry' then null else now() end,lease_expires_at=null
  where id=p_id and lease_token=p_lease and status='processing' returning * into row;
  if row.id is null then raise exception 'LEASE_FENCED'; end if;
  insert into georgie_recovery_audit(deal_id,event_key,event_type,payload) values(row.deal_id,'intent-result:'||row.id,row.kind||'.'||p_status,p_evidence) on conflict(event_key) do nothing;
  return jsonb_build_object('ok',true,'status',p_status,'intentId',p_id);
end $$;

revoke all on function georgie_recovery_ingest_candidate_v2(jsonb,jsonb),georgie_recovery_ingest_reply_v2(jsonb),georgie_recovery_ingest_suppression_v1(jsonb),georgie_claim_recovery_intents(int,int),georgie_recovery_suppression(uuid),georgie_complete_recovery_intent(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function georgie_recovery_ingest_candidate_v2(jsonb,jsonb),georgie_recovery_ingest_reply_v2(jsonb),georgie_recovery_ingest_suppression_v1(jsonb),georgie_claim_recovery_intents(int,int),georgie_recovery_suppression(uuid),georgie_complete_recovery_intent(uuid,uuid,text,jsonb) to service_role;
