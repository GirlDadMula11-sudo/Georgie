-- Georgie rehash multi-contact routing v1.
-- Keeps one canonical merchant/deal while allowing multiple independently supported
-- contact routes. Hard safety gates remain per-address; uncertainty no longer forces
-- a single-address winner.

create table if not exists public.georgie_recovery_contact_routes (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.georgie_recovery_candidates(deal_id) on delete cascade,
  applicant_id text not null,
  thread_id text not null,
  email text not null,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  source text not null,
  merchant_linked boolean not null default false,
  direct_sierra_history boolean not null default false,
  independent_signals int not null default 0 check (independent_signals >= 0),
  state text not null default 'research' check (state in ('research','eligible','engaged','complete','suppressed','invalid')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(deal_id,email),
  unique(thread_id)
);

create index if not exists georgie_recovery_contact_routes_deal_state_idx
  on public.georgie_recovery_contact_routes(deal_id,state,updated_at desc);
create index if not exists georgie_recovery_contact_routes_email_idx
  on public.georgie_recovery_contact_routes(lower(email));
alter table public.georgie_recovery_contact_routes enable row level security;
revoke all on table public.georgie_recovery_contact_routes from public,anon,authenticated;
grant select,insert,update on table public.georgie_recovery_contact_routes to service_role;

-- Derive stable per-route identities without changing the canonical deal identity.
create or replace function public.georgie_route_applicant_id_v1(p_email text)
returns text language sql immutable as $$
  select 'app_' || substr(md5('sierra:' || lower(trim(p_email))),1,24)
$$;

create or replace function public.georgie_route_thread_id_v1(p_deal_id text,p_email text)
returns text language sql immutable as $$
  select 'thread_' || substr(md5('sierra:' || p_deal_id || ':' || lower(trim(p_email))),1,24)
$$;

-- Safe-set rule: merchant linkage is mandatory. A route becomes eligible when it is
-- supported either by Sierra's own history or by at least two independent signals.
-- Confidence is deliberately a soft threshold, not the old 0.85 hard blocker.
create or replace function public.georgie_contact_route_eligible_v1(
  p_merchant_linked boolean,
  p_direct_sierra_history boolean,
  p_independent_signals int,
  p_confidence numeric
) returns boolean language sql immutable as $$
  select coalesce(p_merchant_linked,false)
     and coalesce(p_confidence,0) >= 0.50
     and (coalesce(p_direct_sierra_history,false) or coalesce(p_independent_signals,0) >= 2)
$$;

create or replace function public.georgie_upsert_contact_route_v1(
  p_deal_id text,
  p_email text,
  p_confidence numeric,
  p_source text,
  p_merchant_linked boolean,
  p_direct_sierra_history boolean default false,
  p_independent_signals int default 0,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.georgie_recovery_contact_routes;
  normalized text := lower(trim(coalesce(p_email,'')));
  next_state text;
begin
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'VALID_EMAIL_REQUIRED';
  end if;
  if not exists(select 1 from public.georgie_recovery_candidates where deal_id=p_deal_id) then
    raise exception 'CANONICAL_DEAL_REQUIRED';
  end if;

  next_state := case when public.georgie_contact_route_eligible_v1(
    p_merchant_linked,p_direct_sierra_history,p_independent_signals,p_confidence
  ) then 'eligible' else 'research' end;

  insert into public.georgie_recovery_contact_routes(
    deal_id,applicant_id,thread_id,email,confidence,source,merchant_linked,
    direct_sierra_history,independent_signals,state,metadata
  ) values (
    p_deal_id,
    public.georgie_route_applicant_id_v1(normalized),
    public.georgie_route_thread_id_v1(p_deal_id,normalized),
    normalized,least(greatest(coalesce(p_confidence,0),0),1),coalesce(nullif(p_source,''),'unknown'),
    coalesce(p_merchant_linked,false),coalesce(p_direct_sierra_history,false),
    greatest(coalesce(p_independent_signals,0),0),next_state,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(deal_id,email) do update set
    confidence=greatest(public.georgie_recovery_contact_routes.confidence,excluded.confidence),
    source=excluded.source,
    merchant_linked=public.georgie_recovery_contact_routes.merchant_linked or excluded.merchant_linked,
    direct_sierra_history=public.georgie_recovery_contact_routes.direct_sierra_history or excluded.direct_sierra_history,
    independent_signals=greatest(public.georgie_recovery_contact_routes.independent_signals,excluded.independent_signals),
    state=case
      when public.georgie_recovery_contact_routes.state in ('engaged','complete','suppressed','invalid') then public.georgie_recovery_contact_routes.state
      when public.georgie_contact_route_eligible_v1(
        public.georgie_recovery_contact_routes.merchant_linked or excluded.merchant_linked,
        public.georgie_recovery_contact_routes.direct_sierra_history or excluded.direct_sierra_history,
        greatest(public.georgie_recovery_contact_routes.independent_signals,excluded.independent_signals),
        greatest(public.georgie_recovery_contact_routes.confidence,excluded.confidence)
      ) then 'eligible' else 'research' end,
    metadata=public.georgie_recovery_contact_routes.metadata || excluded.metadata,
    updated_at=now()
  returning * into r;

  return jsonb_build_object('routeId',r.id,'dealId',r.deal_id,'email',r.email,'state',r.state,'confidence',r.confidence);
end $$;

-- Seed every existing canonical Sierra address as a direct-history route.
insert into public.georgie_recovery_contact_routes(
  deal_id,applicant_id,thread_id,email,confidence,source,merchant_linked,
  direct_sierra_history,independent_signals,state,metadata
)
select c.deal_id,c.applicant_id,c.thread_id,lower(c.email),
       least(greatest(coalesce(nullif(c.payload->>'confidence','')::numeric,0.75),0),1),
       'canonical_sierra_history',true,true,1,'eligible',
       jsonb_build_object('backfilled',true,'sourceApplicationId',c.source_application_id)
from public.georgie_recovery_candidates c
where coalesce(c.email,'')<>''
on conflict(deal_id,email) do nothing;

-- Pull additional merchant-linked candidates already discovered by Georgie's contact
-- resolution system. Dossier association supplies merchant linkage. Multiple plausible
-- emails are retained rather than forcing a single winner.
create or replace function public.georgie_sync_contact_routes_v1(p_limit int default 500)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  x record;
  considered int := 0;
  eligible_count int := 0;
  research_count int := 0;
  result jsonb;
begin
  for x in
    select c.deal_id, cr.candidate_email, coalesce(cr.confidence,0)::numeric confidence,
           cr.status, d.id dossier_id
    from public.georgie_contact_resolution cr
    join public.georgie_rehash_merchant_dossiers d on d.id=cr.dossier_id
    join public.georgie_recovery_candidates c
      on c.deal_id=d.merchant_id or c.source_application_id=d.merchant_id
    where coalesce(cr.candidate_email,'')<>''
    order by cr.created_at desc
    limit least(greatest(p_limit,1),2000)
  loop
    considered := considered + 1;
    result := public.georgie_upsert_contact_route_v1(
      x.deal_id,x.candidate_email,x.confidence,'contact_resolution',true,
      false,
      case when lower(coalesce(x.status,'')) in ('verified','confirmed') then 2 else 1 end,
      jsonb_build_object('dossierId',x.dossier_id,'resolutionStatus',x.status)
    );
    if result->>'state'='eligible' then eligible_count:=eligible_count+1; else research_count:=research_count+1; end if;
  end loop;
  return jsonb_build_object('ok',true,'contract','georgie.rehash-contact-routes.v1','considered',considered,'eligible',eligible_count,'research',research_count);
end $$;

-- Fan out a single merchant's statement request to every safe contact route. The secure
-- link remains merchant/deal scoped; each email gets its own thread and idempotency key.
create or replace function public.georgie_enqueue_contact_routes_v1(
  p_deal_id text,
  p_prism_packet jsonb,
  p_secure_link text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  c public.georgie_recovery_candidates;
  r public.georgie_recovery_contact_routes;
  k text;
  created_count int := 0;
  considered_count int := 0;
  months text;
begin
  select * into c from public.georgie_recovery_candidates where deal_id=p_deal_id;
  if c.id is null then raise exception 'CANONICAL_DEAL_REQUIRED'; end if;
  months := array_to_string(array(select jsonb_array_elements_text(p_prism_packet#>'{facts,missingRecentMonths}')),'.');

  for r in
    select * from public.georgie_recovery_contact_routes
    where deal_id=p_deal_id and state='eligible'
    order by confidence desc, created_at asc
    limit 3
  loop
    considered_count:=considered_count+1;
    -- Hard per-address safety stops remain absolute.
    if exists(
      select 1 from public.georgie_recovery_suppressions s
      where (lower(s.email)=lower(r.email) or s.applicant_id=r.applicant_id)
        and (s.expires_at is null or s.expires_at>now())
    ) then
      update public.georgie_recovery_contact_routes set state='suppressed',updated_at=now() where id=r.id;
      continue;
    end if;

    k := 'statement-request:'||p_deal_id||':'||substr(md5(lower(r.email)),1,16)||':'||months||':georgie.financing-recovery.v2';
    insert into public.georgie_recovery_intents(deal_id,applicant_id,thread_id,kind,idempotency_key,payload)
    values(
      p_deal_id,r.applicant_id,r.thread_id,'statement_request',k,
      c.payload || jsonb_build_object(
        'email',r.email,'applicantId',r.applicant_id,'threadId',r.thread_id,
        'contactRouteId',r.id,'contactRouteConfidence',r.confidence,
        'contactRouteSource',r.source,'prismPacket',p_prism_packet,'secureLink',p_secure_link
      )
    ) on conflict(idempotency_key) do nothing;
    if found then created_count:=created_count+1; end if;
  end loop;

  return jsonb_build_object('ok',true,'dealId',p_deal_id,'considered',considered_count,'created',created_count);
end $$;

-- Prism runs once per merchant, then outreach fans out to the safe contact set.
create or replace function public.georgie_complete_prism_precontact_v1(
  p_id uuid,p_lease uuid,p_packet jsonb,p_secure_link text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  source public.georgie_recovery_intents;
  fanout jsonb;
begin
  if p_packet->>'contract' <> 'georgie.prism-precontact.v1'
    or jsonb_array_length(coalesce(p_packet->'evidenceIds','[]'))=0
    or jsonb_array_length(coalesce(p_packet#>'{facts,missingRecentMonths}','[]'))<>2
  then raise exception 'PRISM_PRECONTACT_PACKET_INVALID'; end if;

  update public.georgie_recovery_intents
  set status='completed',provider_evidence=p_packet,completed_at=now(),lease_expires_at=null
  where id=p_id and lease_token=p_lease and status='processing'
  returning * into source;
  if source.id is null then raise exception 'LEASE_FENCED'; end if;

  perform public.georgie_sync_contact_routes_v1(500);
  fanout := public.georgie_enqueue_contact_routes_v1(source.deal_id,p_packet,p_secure_link);

  insert into public.georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload)
  values(source.deal_id,'prism-precontact:'||(p_packet->>'evidenceVersion'),'prism.precontact.completed',
         array(select jsonb_array_elements_text(p_packet->'evidenceIds')),
         p_packet || jsonb_build_object('contactFanout',fanout))
  on conflict(event_key) do nothing;

  return jsonb_build_object('intentId',source.id,'packetPersisted',true,'contactFanout',fanout);
end $$;

-- Safety gate is now per intended route, not deal-wide. This lets two legitimate
-- addresses receive the initial request while still honoring suppression/bounces.
create or replace function public.georgie_recovery_suppression(p_intent_id uuid)
returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select case
    when not exists(select 1 from public.georgie_recovery_intents where id=p_intent_id and status='processing')
      then jsonb_build_object('allowed',false,'reason','intent_state_uncertain')
    when exists(
      select 1 from public.georgie_recovery_intents i
      join public.georgie_recovery_suppressions s
        on (lower(s.email)=lower(i.payload->>'email') or s.applicant_id=i.applicant_id)
      where i.id=p_intent_id and (s.expires_at is null or s.expires_at>now())
    ) then jsonb_build_object('allowed',false,'reason','global_suppression')
    when exists(
      select 1 from public.georgie_recovery_intents i
      join public.georgie_recovery_audit a on a.deal_id=i.deal_id
      where i.id=p_intent_id
        and a.event_type in ('statement_request.sent','statement_followup.sent')
        and a.payload->>'threadId'=i.thread_id
        and a.created_at>now()-interval '2 days'
    ) then jsonb_build_object('allowed',false,'reason','contact_frequency')
    else jsonb_build_object('allowed',true)
  end
$$;

-- Any real engagement collapses the remaining duplicate paths for this merchant.
create or replace function public.georgie_collapse_contact_routes_v1(
  p_deal_id text,p_engaged_thread_id text,p_reason text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed_routes int; changed_intents int;
begin
  update public.georgie_recovery_contact_routes
  set state=case when thread_id=p_engaged_thread_id then 'engaged' else 'complete' end,updated_at=now()
  where deal_id=p_deal_id and state in ('eligible','research','engaged');
  get diagnostics changed_routes=row_count;

  update public.georgie_recovery_intents
  set status='suppressed',completed_at=now(),provider_evidence=jsonb_build_object('reason','merchant_engaged_elsewhere','trigger',p_reason)
  where deal_id=p_deal_id and thread_id<>coalesce(p_engaged_thread_id,'')
    and kind in ('statement_request','statement_followup') and status in ('pending','retry');
  get diagnostics changed_intents=row_count;

  insert into public.georgie_recovery_audit(deal_id,event_key,event_type,payload)
  values(p_deal_id,'contact-collapse:'||substr(md5(coalesce(p_engaged_thread_id,'')||':'||coalesce(p_reason,'')||':'||now()::date::text),1,24),
         'contact_routes.collapsed',jsonb_build_object('threadId',p_engaged_thread_id,'reason',p_reason,'routes',changed_routes,'intents',changed_intents))
  on conflict(event_key) do nothing;
  return jsonb_build_object('ok',true,'routes',changed_routes,'intents',changed_intents);
end $$;

-- Reply identity can resolve through either the canonical thread or an eligible contact route.
create or replace function public.georgie_recovery_ingest_reply_v2(p_reply jsonb)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  candidate_row public.georgie_recovery_candidates;
  route_row public.georgie_recovery_contact_routes;
  resolved_applicant text;
  resolved_thread text;
  intent_key text;
  intent_kind text;
  intent_row public.georgie_recovery_intents;
  inserted boolean:=false;
begin
  select * into candidate_row from public.georgie_recovery_candidates where deal_id=p_reply->>'dealId';
  if candidate_row.id is null then raise exception 'EXACT_REPLY_IDENTITY_UNRESOLVED'; end if;
  select * into route_row from public.georgie_recovery_contact_routes
    where deal_id=candidate_row.deal_id and thread_id=p_reply->>'threadId' limit 1;
  if route_row.id is null and candidate_row.thread_id<>p_reply->>'threadId' then raise exception 'EXACT_REPLY_IDENTITY_UNRESOLVED'; end if;

  resolved_applicant:=coalesce(route_row.applicant_id,candidate_row.applicant_id);
  resolved_thread:=coalesce(route_row.thread_id,candidate_row.thread_id);

  insert into public.georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload)
  values(candidate_row.deal_id,p_reply->>'replyKey','reply.received',
         array(select jsonb_array_elements_text(coalesce(p_reply->'evidenceIds','[]'::jsonb))),
         p_reply || jsonb_build_object('resolvedThreadId',resolved_thread))
  on conflict(event_key) do nothing;

  perform public.georgie_collapse_contact_routes_v1(candidate_row.deal_id,resolved_thread,'reply_received');

  if coalesce(p_reply->>'closerKey','')<>'' then intent_key:=p_reply->>'closerKey'; intent_kind:='closer_handoff';
  elsif coalesce(p_reply->>'prismKey','')<>'' then intent_key:=p_reply->>'prismKey'; intent_kind:='prism_wakeup';
  else intent_key:=p_reply->>'acknowledgementKey'; intent_kind:='acknowledgement'; end if;

  if coalesce(intent_key,'')='' then
    return jsonb_build_object('deduplicated',false,'replyKey',p_reply->>'replyKey','intentCreated',false,'collapsed',true);
  end if;

  insert into public.georgie_recovery_intents(deal_id,applicant_id,thread_id,kind,idempotency_key,payload)
  values(candidate_row.deal_id,resolved_applicant,resolved_thread,intent_kind,intent_key,candidate_row.payload||p_reply)
  on conflict(idempotency_key) do nothing returning * into intent_row;
  inserted:=intent_row.id is not null;
  if not inserted then select * into intent_row from public.georgie_recovery_intents where idempotency_key=intent_key; end if;
  return jsonb_build_object('deduplicated',not inserted,'replyKey',p_reply->>'replyKey','intentId',intent_row.id,'intentCreated',inserted,'intentKind',intent_kind);
end $$;

-- Uploading even one valid statement is enough engagement to stop duplicate-contact nudges.
create or replace function public.georgie_contact_route_upload_collapse_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.georgie_recovery_upload_tokens; engaged_thread text;
begin
  select * into t from public.georgie_recovery_upload_tokens where id=new.token_id;
  select thread_id into engaged_thread from public.georgie_recovery_contact_routes
    where deal_id=new.episode_id and applicant_id=new.applicant_id limit 1;
  perform public.georgie_collapse_contact_routes_v1(new.episode_id,coalesce(engaged_thread,''),'statement_uploaded');
  return new;
end $$;

drop trigger if exists georgie_contact_route_upload_collapse on public.georgie_recovery_uploads;
create trigger georgie_contact_route_upload_collapse
after insert on public.georgie_recovery_uploads
for each row execute function public.georgie_contact_route_upload_collapse_v1();

revoke all on function public.georgie_route_applicant_id_v1(text),
  public.georgie_route_thread_id_v1(text,text),
  public.georgie_contact_route_eligible_v1(boolean,boolean,int,numeric),
  public.georgie_upsert_contact_route_v1(text,text,numeric,text,boolean,boolean,int,jsonb),
  public.georgie_sync_contact_routes_v1(int),
  public.georgie_enqueue_contact_routes_v1(text,jsonb,text),
  public.georgie_collapse_contact_routes_v1(text,text,text)
from public,anon,authenticated;

grant execute on function public.georgie_upsert_contact_route_v1(text,text,numeric,text,boolean,boolean,int,jsonb),
  public.georgie_sync_contact_routes_v1(int),
  public.georgie_enqueue_contact_routes_v1(text,jsonb,text),
  public.georgie_collapse_contact_routes_v1(text,text,text)
to service_role;

revoke all on function public.georgie_recovery_ingest_reply_v2(jsonb),
  public.georgie_complete_prism_precontact_v1(uuid,uuid,jsonb,text),
  public.georgie_recovery_suppression(uuid)
from public,anon,authenticated;

grant execute on function public.georgie_recovery_ingest_reply_v2(jsonb),
  public.georgie_complete_prism_precontact_v1(uuid,uuid,jsonb,text),
  public.georgie_recovery_suppression(uuid)
to service_role;
