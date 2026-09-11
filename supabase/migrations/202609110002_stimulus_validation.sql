begin;
create function public.validate_stimulus(aid uuid, evidence jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a public.artifacts;
begin
 select * into a from public.artifacts where id=aid for update;
 if a.id is null or not public.owns_workspace(a.workspace_id) or a.kind<>'stimulus' or a.status not in ('ready','verified') then raise exception 'forbidden'; end if;
 if jsonb_typeof(evidence->'speakers') is distinct from 'array' or length(coalesce(evidence->>'method',''))<20 or length(coalesce(evidence->>'route',''))<5 or evidence->>'markersVerified' is distinct from 'true' then raise exception 'record channel mapping, route, and marker validation evidence'; end if;
 update public.artifacts set status='verified',manifest=manifest||jsonb_build_object('channelMappingVerified',true,'validation',evidence||jsonb_build_object('validatedAt',now(),'validatedBy',auth.uid())) where id=aid;
end $$;
revoke execute on function public.validate_stimulus(uuid,jsonb) from public,anon;
grant execute on function public.validate_stimulus(uuid,jsonb) to authenticated;
-- Paired Macs may back up experimental history; mutation remains owner-only.
create policy experiments_mac_read on public.experiments for select to authenticated using(public.member_of(workspace_id,array['mac']));
commit;
