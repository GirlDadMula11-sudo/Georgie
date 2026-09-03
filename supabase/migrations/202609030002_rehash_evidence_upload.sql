-- Historical rehash evidence, secure upload, omnichannel and economics extensions.
create table if not exists georgie_recovery_evidence (
  id uuid primary key default gen_random_uuid(), content_hash text not null unique, applicant_id text,
  source_id text not null, source_object_id text not null, classification text not null,
  extracted jsonb not null, evidence_ids text[] not null default '{}', confidence numeric,
  status text not null check(status in('verified','quarantined')), quarantine_reason text,
  processing_cost numeric not null default 0, created_at timestamptz not null default now()
);
create table if not exists georgie_recovery_upload_tokens (
  id uuid primary key default gen_random_uuid(), token_hash text not null unique, applicant_id text not null,
  episode_id text not null, requested_months text[] not null check(cardinality(requested_months)=2),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists georgie_recovery_uploads (
  id uuid primary key default gen_random_uuid(), token_id uuid not null references georgie_recovery_upload_tokens(id),
  applicant_id text not null, episode_id text not null, content_hash text not null,
  statement_month text not null, evidence_ids text[] not null, idempotency_key text not null unique,
  created_at timestamptz not null default now(), unique(episode_id,statement_month), unique(content_hash)
);
create table if not exists georgie_recovery_conversations (
  id uuid primary key default gen_random_uuid(), applicant_id text not null, deal_id text not null,
  episode_id text not null unique, state jsonb not null default '{}', stopped_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists georgie_recovery_channel_events (
  id uuid primary key default gen_random_uuid(), episode_id text not null, channel text not null check(channel in('email','sms')),
  step text not null, provider_event_id text, idempotency_key text not null unique, status text not null,
  receipt jsonb, cost numeric not null default 0, created_at timestamptz not null default now(),
  unique(episode_id,step)
);
create table if not exists georgie_recovery_outcomes (
  id uuid primary key default gen_random_uuid(), episode_id text not null, event_type text not null,
  idempotency_key text not null unique, amount numeric, evidence_ids text[] not null default '{}', created_at timestamptz not null default now()
);
alter table georgie_recovery_evidence enable row level security;
alter table georgie_recovery_upload_tokens enable row level security;

alter table georgie_recovery_uploads enable row level security;
alter table georgie_recovery_conversations enable row level security;
alter table georgie_recovery_channel_events enable row level security;
alter table georgie_recovery_outcomes enable row level security;

create or replace function georgie_complete_prism_precontact_v1(p_id uuid,p_lease uuid,p_packet jsonb,p_secure_link text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare source georgie_recovery_intents; outreach georgie_recovery_intents; outreach_key text;
begin
  if p_packet->>'contract' <> 'georgie.prism-precontact.v1' or jsonb_array_length(coalesce(p_packet->'evidenceIds','[]'))=0 or jsonb_array_length(coalesce(p_packet#>'{facts,missingRecentMonths}','[]'))<>2 then raise exception 'PRISM_PRECONTACT_PACKET_INVALID'; end if;
  update georgie_recovery_intents set status='completed',provider_evidence=p_packet,completed_at=now(),lease_expires_at=null where id=p_id and lease_token=p_lease and status='processing' returning * into source;
  if source.id is null then raise exception 'LEASE_FENCED'; end if;
  outreach_key:='statement-request:'||source.deal_id||':'||array_to_string(array(select jsonb_array_elements_text(p_packet#>'{facts,missingRecentMonths}')),'.')||':georgie.financing-recovery.v2';
  insert into georgie_recovery_intents(deal_id,applicant_id,thread_id,kind,idempotency_key,payload)
  values(source.deal_id,source.applicant_id,source.thread_id,'statement_request',outreach_key,source.payload||jsonb_build_object('prismPacket',p_packet,'secureLink',p_secure_link)) on conflict(idempotency_key) do nothing returning * into outreach;
  if outreach.id is null then select * into outreach from georgie_recovery_intents where idempotency_key=outreach_key; end if;
  insert into georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload) values(source.deal_id,'prism-precontact:'||(p_packet->>'evidenceVersion'),'prism.precontact.completed',array(select jsonb_array_elements_text(p_packet->'evidenceIds')),p_packet) on conflict(event_key) do nothing;
  return jsonb_build_object('intentId',source.id,'outreachIntentId',outreach.id,'packetPersisted',true);
end $$;

create or replace function georgie_ingest_recovery_evidence_v1(p_evidence jsonb,p_quarantine_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$ declare row georgie_recovery_evidence; inserted boolean:=false; begin
  insert into georgie_recovery_evidence(content_hash,applicant_id,source_id,source_object_id,classification,extracted,evidence_ids,confidence,status,quarantine_reason)
  values(p_evidence->>'contentHash',nullif(p_evidence->>'applicantId',''),p_evidence->>'sourceId',p_evidence->>'sourceObjectId',p_evidence->>'type',p_evidence,array(select jsonb_array_elements_text(coalesce(p_evidence->'evidenceIds','[]'))),nullif(p_evidence->>'confidence','')::numeric,case when p_quarantine_reason is null then 'verified' else 'quarantined' end,p_quarantine_reason)
  on conflict(content_hash) do nothing returning * into row; inserted:=row.id is not null;
  if not inserted then select * into row from georgie_recovery_evidence where content_hash=p_evidence->>'contentHash'; end if;
  return jsonb_build_object('evidenceId',row.id,'created',inserted,'status',row.status,'contentHash',row.content_hash);
end $$;

create or replace function georgie_issue_recovery_upload_token_v1(p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare row georgie_recovery_upload_tokens; begin
  if p_request->>'contract'<>'georgie.recovery-upload-token.v1' or jsonb_array_length(p_request->'requestedMonths')<>2 or (p_request->>'expiresAt')::timestamptz<=now() then raise exception 'UPLOAD_TOKEN_REQUEST_INVALID'; end if;
  insert into georgie_recovery_upload_tokens(token_hash,applicant_id,episode_id,requested_months,expires_at) values(p_request->>'tokenHash',p_request->>'applicantId',p_request->>'episodeId',array(select jsonb_array_elements_text(p_request->'requestedMonths')),(p_request->>'expiresAt')::timestamptz) returning * into row;
  return jsonb_build_object('tokenId',row.id,'created',true);
end $$;
create or replace function georgie_resolve_recovery_upload_token_v1(p_token_hash text) returns jsonb
language sql security definer set search_path=public as $$ select jsonb_build_object('applicantId',applicant_id,'episodeId',episode_id,'requestedMonths',requested_months,'expiresAt',expires_at,'revoked',revoked_at is not null) from georgie_recovery_upload_tokens where token_hash=p_token_hash $$;
create or replace function georgie_complete_recovery_upload_v1(p_upload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare token georgie_recovery_upload_tokens; row georgie_recovery_uploads; verified_count int; crm_key text; crm_count int; begin
  select * into token from georgie_recovery_upload_tokens where token_hash=p_upload->>'tokenHash' and revoked_at is null and expires_at>now() for update;
  if token.id is null or not ((p_upload->>'statementMonth')=any(token.requested_months)) or token.applicant_id<>p_upload->>'applicantId' then raise exception 'UPLOAD_TOKEN_SCOPE_INVALID'; end if;
  insert into georgie_recovery_uploads(token_id,applicant_id,episode_id,content_hash,statement_month,evidence_ids,idempotency_key) values(token.id,token.applicant_id,token.episode_id,p_upload->>'contentHash',p_upload->>'statementMonth',array(select jsonb_array_elements_text(p_upload->'evidenceIds')),p_upload->>'idempotencyKey') on conflict(idempotency_key) do nothing returning * into row;
  select count(distinct statement_month) into verified_count from georgie_recovery_uploads where episode_id=token.episode_id and statement_month=any(token.requested_months);
  if verified_count=2 then
    crm_key:='crm-intake:'||token.episode_id;
    insert into georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload) select c.deal_id,crm_key,'crm.canonical_documents_ready',array(select unnest(u.evidence_ids) from georgie_recovery_uploads u where u.episode_id=token.episode_id),jsonb_build_object('episodeId',token.episode_id,'newApplicationRequired',false) from georgie_recovery_candidates c where c.applicant_id=token.applicant_id and c.deal_id=token.episode_id on conflict(event_key) do nothing;
    select count(*) into crm_count from georgie_recovery_audit where event_key=crm_key;
    if crm_count<>1 then raise exception 'CANONICAL_CRM_DEAL_GATE_FAILED'; end if;
  end if;
  return jsonb_build_object('created',row.id is not null,'verifiedSlots',verified_count,'complete',verified_count=2,'crmEventKey',case when verified_count=2 then crm_key else null end);
end $$;

revoke all on function georgie_complete_prism_precontact_v1(uuid,uuid,jsonb,text),georgie_ingest_recovery_evidence_v1(jsonb,text),georgie_issue_recovery_upload_token_v1(jsonb),georgie_resolve_recovery_upload_token_v1(text),georgie_complete_recovery_upload_v1(jsonb) from public,anon,authenticated;
grant execute on function georgie_complete_prism_precontact_v1(uuid,uuid,jsonb,text),georgie_ingest_recovery_evidence_v1(jsonb,text),georgie_issue_recovery_upload_token_v1(jsonb),georgie_resolve_recovery_upload_token_v1(text),georgie_complete_recovery_upload_v1(jsonb) to service_role;

create or replace function georgie_revoke_recovery_upload_token_v1(p_token_hash text,p_evidence_id text) returns jsonb
language plpgsql security definer set search_path=public as $$ declare changed int; begin
  if coalesce(p_evidence_id,'')='' then raise exception 'REVOCATION_EVIDENCE_REQUIRED'; end if;
  update georgie_recovery_upload_tokens set revoked_at=coalesce(revoked_at,now()) where token_hash=p_token_hash; get diagnostics changed=row_count;
  return jsonb_build_object('revoked',changed=1,'evidenceId',p_evidence_id);
end $$;
create or replace function georgie_recovery_channel_intent_v1(p_event jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare row georgie_recovery_channel_events; begin
  insert into georgie_recovery_channel_events(episode_id,channel,step,idempotency_key,status)
  values(p_event->>'episodeId',p_event->>'channel',p_event->>'step',p_event->>'idempotencyKey','intent')
  on conflict(episode_id,step) do nothing returning * into row;
  if row.id is null then select * into row from georgie_recovery_channel_events where episode_id=p_event->>'episodeId' and step=p_event->>'step'; end if;
  return jsonb_build_object('eventId',row.id,'created',row.idempotency_key=p_event->>'idempotencyKey','channel',row.channel);
end $$;
create or replace function georgie_recovery_sms_event_v1(p_event jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare row georgie_recovery_channel_events; begin
  insert into georgie_recovery_channel_events(episode_id,channel,step,provider_event_id,idempotency_key,status,receipt)
  values(p_event->>'episodeId','sms','inbound',p_event->>'eventId',p_event->>'idempotencyKey',lower(p_event->>'command'),p_event)
  on conflict(idempotency_key) do nothing returning * into row;
  if p_event->>'command'='STOP' then
    insert into georgie_recovery_suppressions(applicant_id,email,reason,evidence_id,source_event_key) values(nullif(p_event->>'applicantId',''),nullif(lower(p_event->>'from'),''),'opt_out',p_event->>'eventId',p_event->>'idempotencyKey') on conflict(source_event_key) do nothing;
    update georgie_recovery_conversations set stopped_at=coalesce(stopped_at,now()) where episode_id=p_event->>'episodeId';
  end if;
  return jsonb_build_object('created',row.id is not null,'command',p_event->>'command');
end $$;
revoke all on function georgie_revoke_recovery_upload_token_v1(text,text),georgie_recovery_channel_intent_v1(jsonb),georgie_recovery_sms_event_v1(jsonb) from public,anon,authenticated;
grant execute on function georgie_revoke_recovery_upload_token_v1(text,text),georgie_recovery_channel_intent_v1(jsonb),georgie_recovery_sms_event_v1(jsonb) to service_role;

create or replace function georgie_recovery_upload_session_v1(p_token_hash text) returns jsonb
language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'status',case when t.revoked_at is not null then 'revoked' when t.expires_at<=now() then 'expired' else 'active' end,
    'firstName',c.payload->>'firstName','businessName',c.payload->>'businessIdentity',
    'requestedMonths',t.requested_months,'expiresAt',t.expires_at,
    'slots',coalesce((select jsonb_agg(jsonb_build_object('month',m,'status',case when u.statement_month is null then 'open' else 'verified' end)) from unnest(t.requested_months) m left join georgie_recovery_uploads u on u.episode_id=t.episode_id and u.statement_month=m),'[]'::jsonb),
    'complete',(select count(distinct statement_month)=2 from georgie_recovery_uploads where episode_id=t.episode_id and statement_month=any(t.requested_months))
  ) from georgie_recovery_upload_tokens t join georgie_recovery_candidates c on c.applicant_id=t.applicant_id and c.deal_id=t.episode_id where t.token_hash=p_token_hash
$$;
revoke all on function georgie_recovery_upload_session_v1(text) from public,anon,authenticated;
grant execute on function georgie_recovery_upload_session_v1(text) to service_role;
