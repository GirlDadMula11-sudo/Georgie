create table if not exists public.georgie_model_spend_ledger (
  reservation_id uuid primary key,
  idempotency_key text not null unique,
  objective_id text,
  model text not null,
  tier text not null,
  escalation_reason text not null,
  reserved_tokens bigint not null check (reserved_tokens > 0),
  estimated_input_tokens bigint not null,
  estimated_output_tokens bigint not null,
  actual_tokens bigint,
  input_tokens bigint,
  output_tokens bigint,
  latency_ms bigint,
  quality_result text,
  outcome text not null default 'reserved',
  error_code text,
  created_at timestamptz not null default now(),
  reconciled_at timestamptz
);
create index if not exists georgie_model_spend_created_idx on public.georgie_model_spend_ledger(created_at);
alter table public.georgie_model_spend_ledger enable row level security;
revoke all on public.georgie_model_spend_ledger from public, anon, authenticated;
grant select, insert, update on public.georgie_model_spend_ledger to service_role;

create or replace function public.georgie_model_spend_reserve(
  p_reservation_id uuid,p_objective_id text,p_model text,p_tier text,p_escalation_reason text,
  p_reserved_tokens bigint,p_estimated_input_tokens bigint,p_estimated_output_tokens bigint,
  p_idempotency_key text,p_request_limit bigint,p_hour_limit bigint,p_day_limit bigint
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare hour_used bigint; day_used bigint; existing public.georgie_model_spend_ledger;
begin
  perform pg_advisory_xact_lock(hashtextextended('georgie-model-spend-ledger',0));
  select * into existing from public.georgie_model_spend_ledger where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('admitted',true,'reservationId',existing.reservation_id,'replayed',true); end if;
  if p_reserved_tokens>p_request_limit then return jsonb_build_object('admitted',false,'reason','request_token_cap'); end if;
  select coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into hour_used from public.georgie_model_spend_ledger where created_at>=now()-interval '1 hour' and outcome<>'released';
  select coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into day_used from public.georgie_model_spend_ledger where created_at>=now()-interval '24 hours' and outcome<>'released';
  if hour_used+p_reserved_tokens>p_hour_limit then return jsonb_build_object('admitted',false,'reason','hour_token_cap','hourTokens',hour_used); end if;
  if day_used+p_reserved_tokens>p_day_limit then return jsonb_build_object('admitted',false,'reason','day_token_cap','dayTokens',day_used); end if;
  insert into public.georgie_model_spend_ledger(reservation_id,idempotency_key,objective_id,model,tier,escalation_reason,reserved_tokens,estimated_input_tokens,estimated_output_tokens)
  values(p_reservation_id,p_idempotency_key,p_objective_id,p_model,p_tier,p_escalation_reason,p_reserved_tokens,p_estimated_input_tokens,p_estimated_output_tokens);
  return jsonb_build_object('admitted',true,'reservationId',p_reservation_id,'hourReserved',hour_used+p_reserved_tokens,'dayReserved',day_used+p_reserved_tokens,'replayed',false);
end $$;

create or replace function public.georgie_model_spend_reconcile(
  p_reservation_id uuid,p_actual_tokens bigint,p_input_tokens bigint,p_output_tokens bigint,
  p_latency_ms bigint,p_quality_result text,p_outcome text,p_error_code text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare changed public.georgie_model_spend_ledger;
begin
  update public.georgie_model_spend_ledger set
    actual_tokens=greatest(0,p_actual_tokens),input_tokens=greatest(0,p_input_tokens),
    output_tokens=greatest(0,p_output_tokens),latency_ms=greatest(0,p_latency_ms),
    quality_result=p_quality_result,outcome=p_outcome,error_code=p_error_code,reconciled_at=now()
  where reservation_id=p_reservation_id returning * into changed;
  if not found then raise exception 'MODEL_SPEND_RESERVATION_NOT_FOUND'; end if;
  return jsonb_build_object('reservationId',changed.reservation_id,'actualTokens',changed.actual_tokens,'outcome',changed.outcome);
end $$;

revoke all on function public.georgie_model_spend_reserve(uuid,text,text,text,text,bigint,bigint,bigint,text,bigint,bigint,bigint) from public;
revoke all on function public.georgie_model_spend_reconcile(uuid,bigint,bigint,bigint,bigint,text,text,text) from public;
grant execute on function public.georgie_model_spend_reserve(uuid,text,text,text,text,bigint,bigint,bigint,text,bigint,bigint,bigint) to service_role;
grant execute on function public.georgie_model_spend_reconcile(uuid,bigint,bigint,bigint,bigint,text,text,text) to service_role;
