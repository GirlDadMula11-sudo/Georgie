-- Cross-runtime/schema hardening for route synchronization.
-- merchant_id may be text or uuid depending on the dossier-generation cohort;
-- compare through text so the migration remains deterministic across cohorts.
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
      on c.deal_id=d.merchant_id::text or c.source_application_id=d.merchant_id::text
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
