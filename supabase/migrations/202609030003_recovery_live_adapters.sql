-- Live-adapter evidence and private storage controls. Apply only through governed migration release.
do $$ begin
  if exists(select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('georgie-recovery-statements','georgie-recovery-statements',false,10485760,array['application/pdf','image/jpeg','image/png'])
    on conflict(id) do update set public=false,file_size_limit=least(storage.buckets.file_size_limit,10485760),allowed_mime_types=excluded.allowed_mime_types;
  end if;
end $$;

alter table georgie_recovery_uploads add column if not exists storage_receipt jsonb;
alter table georgie_recovery_uploads add column if not exists retention_until timestamptz;
create table if not exists georgie_recovery_adapter_receipts(
  id bigserial primary key, episode_id text not null, boundary text not null,
  idempotency_key text not null unique, receipt jsonb not null, evidence_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists georgie_recovery_crm_links(
  id uuid primary key default gen_random_uuid(), episode_id text not null unique,
  canonical_deal_id text not null unique, external_deal_id text not null unique,
  idempotency_key text not null unique, receipt_id text not null, evidence_ids text[] not null,
  created_at timestamptz not null default now()
);
create table if not exists georgie_recovery_canary_reports(
  id uuid primary key default gen_random_uuid(), run_id text not null unique,
  report jsonb not null, created_at timestamptz not null default now()
);
alter table georgie_recovery_adapter_receipts enable row level security;
alter table georgie_recovery_crm_links enable row level security;
alter table georgie_recovery_canary_reports enable row level security;

create or replace function georgie_recovery_receipts_immutable() returns trigger language plpgsql as $$ begin raise exception 'RECOVERY_RECEIPTS_IMMUTABLE'; end $$;
drop trigger if exists georgie_recovery_adapter_receipts_immutable on georgie_recovery_adapter_receipts;
create trigger georgie_recovery_adapter_receipts_immutable before update or delete on georgie_recovery_adapter_receipts for each row execute function georgie_recovery_receipts_immutable();

create or replace function georgie_record_recovery_adapter_receipt_v1(p_episode_id text,p_boundary text,p_idempotency_key text,p_receipt jsonb,p_evidence_ids text[]) returns jsonb
language plpgsql security definer set search_path=public as $$ declare row georgie_recovery_adapter_receipts; begin
  if coalesce(p_receipt->>'receiptId',p_receipt->>'messageId','')='' then raise exception 'ADAPTER_RECEIPT_ID_REQUIRED'; end if;
  insert into georgie_recovery_adapter_receipts(episode_id,boundary,idempotency_key,receipt,evidence_ids) values(p_episode_id,p_boundary,p_idempotency_key,p_receipt,coalesce(p_evidence_ids,'{}')) on conflict(idempotency_key) do nothing returning * into row;
  if row.id is null then select * into row from georgie_recovery_adapter_receipts where idempotency_key=p_idempotency_key; end if;
  return jsonb_build_object('receiptId',row.id,'deduplicated',row.idempotency_key<>p_idempotency_key,'boundary',row.boundary);
end $$;

create or replace function georgie_record_recovery_crm_link_v1(p_link jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare uploads int; row georgie_recovery_crm_links; begin
  if p_link->>'rawApplication'='true' then raise exception 'RAW_APPLICATION_CRM_FORBIDDEN'; end if;
  select count(distinct statement_month) into uploads from georgie_recovery_uploads where episode_id=p_link->>'episodeId';
  if uploads<>2 then raise exception 'TWO_VERIFIED_STATEMENTS_REQUIRED'; end if;
  insert into georgie_recovery_crm_links(episode_id,canonical_deal_id,external_deal_id,idempotency_key,receipt_id,evidence_ids)
  values(p_link->>'episodeId',p_link->>'canonicalDealId',p_link->>'externalDealId',p_link->>'idempotencyKey',p_link->>'receiptId',array(select jsonb_array_elements_text(p_link->'evidenceIds')))
  on conflict(episode_id) do nothing returning * into row;
  if row.id is null then select * into row from georgie_recovery_crm_links where episode_id=p_link->>'episodeId'; end if;
  if row.canonical_deal_id<>p_link->>'canonicalDealId' or row.external_deal_id<>p_link->>'externalDealId' then raise exception 'CRM_IDENTITY_CONFLICT'; end if;
  return jsonb_build_object('linkId',row.id,'externalDealId',row.external_deal_id,'verified',true);
end $$;

create or replace function georgie_recovery_adapter_status_v1() returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('database',true,'privateStorage',coalesce((select public=false from storage.buckets where id='georgie-recovery-statements'),false),'receiptCount',(select count(*) from georgie_recovery_adapter_receipts),'crmLinkCount',(select count(*) from georgie_recovery_crm_links),'lastCanaryAt',(select max(created_at) from georgie_recovery_canary_reports))
$$;
revoke all on table georgie_recovery_adapter_receipts,georgie_recovery_crm_links,georgie_recovery_canary_reports from anon,authenticated;
revoke all on function georgie_record_recovery_adapter_receipt_v1(text,text,text,jsonb,text[]),georgie_record_recovery_crm_link_v1(jsonb),georgie_recovery_adapter_status_v1() from public,anon,authenticated;
grant execute on function georgie_record_recovery_adapter_receipt_v1(text,text,text,jsonb,text[]),georgie_record_recovery_crm_link_v1(jsonb),georgie_recovery_adapter_status_v1() to service_role;

create or replace function georgie_complete_recovery_upload_v1(p_upload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare token georgie_recovery_upload_tokens; row georgie_recovery_uploads; verified_count int; crm_key text; crm_count int; begin
  select * into token from georgie_recovery_upload_tokens where token_hash=p_upload->>'tokenHash' and revoked_at is null and expires_at>now() for update;
  if token.id is null or not ((p_upload->>'statementMonth')=any(token.requested_months)) or token.applicant_id<>p_upload->>'applicantId' then raise exception 'UPLOAD_TOKEN_SCOPE_INVALID'; end if;
  if p_upload#>>'{storageReceipt,immutable}'<>'true' or p_upload#>>'{storageReceipt,contentHash}'<>p_upload->>'contentHash' or coalesce(p_upload#>>'{storageReceipt,receiptId}','')='' or nullif(p_upload->>'retentionUntil','')::timestamptz<=now() then raise exception 'IMMUTABLE_STORAGE_RECEIPT_REQUIRED'; end if;
  insert into georgie_recovery_uploads(token_id,applicant_id,episode_id,content_hash,statement_month,evidence_ids,idempotency_key,storage_receipt,retention_until)
  values(token.id,token.applicant_id,token.episode_id,p_upload->>'contentHash',p_upload->>'statementMonth',array(select jsonb_array_elements_text(p_upload->'evidenceIds')),p_upload->>'idempotencyKey',p_upload->'storageReceipt',(p_upload->>'retentionUntil')::timestamptz) on conflict(idempotency_key) do nothing returning * into row;
  select count(distinct statement_month) into verified_count from georgie_recovery_uploads where episode_id=token.episode_id and statement_month=any(token.requested_months);
  if verified_count=2 then crm_key:='crm-intake:'||token.episode_id; insert into georgie_recovery_audit(deal_id,event_key,event_type,evidence_ids,payload) select c.deal_id,crm_key,'crm.canonical_documents_ready',array(select unnest(u.evidence_ids) from georgie_recovery_uploads u where u.episode_id=token.episode_id),jsonb_build_object('episodeId',token.episode_id,'newApplicationRequired',false) from georgie_recovery_candidates c where c.applicant_id=token.applicant_id and c.deal_id=token.episode_id on conflict(event_key) do nothing; select count(*) into crm_count from georgie_recovery_audit where event_key=crm_key; if crm_count<>1 then raise exception 'CANONICAL_CRM_DEAL_GATE_FAILED'; end if; end if;
  return jsonb_build_object('created',row.id is not null,'verifiedSlots',verified_count,'complete',verified_count=2,'crmEventKey',case when verified_count=2 then crm_key else null end);
end $$;
