begin;
create extension if not exists pgcrypto with schema extensions;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 120), created_at timestamptz not null default now()
);
create table public.devices (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id), name text not null, kind text not null check(kind in ('mac','recorder','tv')),
  capabilities jsonb, pairing_hash text, pairing_expires timestamptz, revoked_at timestamptz, last_seen timestamptz,
  created_at timestamptz not null default now()
);
create table public.measurement_sessions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  generation integer not null default 1, state text not null default 'draft' check(state in ('draft','preparing','armed','playing','captured','analyzing','complete','interrupted')),
  context jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.commands (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.measurement_sessions(id),
  target_device_id uuid not null references public.devices(id), generation integer not null,
  sequence bigint generated always as identity, action text not null check(action in ('prepare','start','stop','analyze')),
  payload jsonb not null default '{}', expires_at timestamptz not null default(now()+interval '30 seconds'),
  lease_until timestamptz not null default(now()+interval '5 seconds'),
  acknowledged_at timestamptz, result jsonb, created_at timestamptz not null default now()
);
create table public.artifacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  session_id uuid not null references public.measurement_sessions(id), created_by uuid not null default auth.uid() references auth.users(id),
  kind text not null check(kind in ('capture','impulse','stimulus','calibration','report')),
  manifest jsonb not null default '{}', status text not null default 'uploading' check(status in ('uploading','ready','verified','invalid')),
  created_at timestamptz not null default now()
);
create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  session_id uuid not null references public.measurement_sessions(id), artifact_id uuid not null references public.artifacts(id),
  state text not null default 'queued' check(state in ('queued','running','complete','failed')),
  worker_id uuid references public.devices(id), lease_until timestamptz, error text, created_at timestamptz not null default now(),
  unique(artifact_id)
);
create table public.analysis_results (
  id uuid primary key, workspace_id uuid not null references public.workspaces(id),
  session_id uuid not null references public.measurement_sessions(id), artifact_id uuid references public.artifacts(id),
  version text not null, data jsonb not null, created_at timestamptz not null default now()
);
create table public.experiments (
  id uuid primary key, workspace_id uuid not null references public.workspaces(id), data jsonb not null, created_at timestamptz not null default now()
);
create table public.project_settings (
  workspace_id uuid primary key references public.workspaces(id), context jsonb not null, revision bigint not null default 1, updated_at timestamptz not null default now()
);
create index devices_actor on public.devices(auth_user_id,workspace_id) where revoked_at is null;
create index pending_commands on public.commands(target_device_id,sequence) where acknowledged_at is null;
create index queued_jobs on public.analysis_jobs(state,created_at);
create index session_workspace on public.measurement_sessions(workspace_id,created_at);

create function public.owns_workspace(w uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.workspaces where id=w and owner_id=auth.uid());
$$;
create function public.member_of(w uuid, kinds text[] default array['mac','recorder','tv']) returns boolean language sql stable security definer set search_path = '' as $$
 select public.owns_workspace(w) or exists(select 1 from public.devices where workspace_id=w and auth_user_id=auth.uid() and revoked_at is null and kind=any(kinds));
$$;
create function public.controls_device(d uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.devices where id=d and revoked_at is null and workspace_id is not null and (auth_user_id=auth.uid() or public.owns_workspace(workspace_id)));
$$;

alter table public.workspaces enable row level security;
alter table public.devices enable row level security;
alter table public.measurement_sessions enable row level security;
alter table public.commands enable row level security;
alter table public.artifacts enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.analysis_results enable row level security;
alter table public.experiments enable row level security;
alter table public.project_settings enable row level security;

create policy workspace_read on public.workspaces for select to authenticated using(owner_id=auth.uid() or public.member_of(id));
create policy workspace_create on public.workspaces for insert to authenticated with check(owner_id=auth.uid() and coalesce(auth.jwt()->>'is_anonymous','false')='false');
create policy devices_read on public.devices for select to authenticated using(auth_user_id=auth.uid() or public.owns_workspace(workspace_id));
create policy session_read on public.measurement_sessions for select to authenticated using(public.member_of(workspace_id));
create policy session_create on public.measurement_sessions for insert to authenticated with check(public.member_of(workspace_id,array['mac']));
create policy command_read on public.commands for select to authenticated using(public.controls_device(target_device_id));
create policy artifact_read on public.artifacts for select to authenticated using(public.member_of(workspace_id,array['mac']) or (created_by=auth.uid() and public.member_of(workspace_id,array['recorder'])) or (kind='stimulus' and public.member_of(workspace_id,array['tv'])));
create policy artifact_create on public.artifacts for insert to authenticated with check(public.member_of(workspace_id,array['mac','recorder']) and created_by=auth.uid() and exists(select 1 from public.measurement_sessions s where s.id=session_id and s.workspace_id=artifacts.workspace_id));
create policy job_read on public.analysis_jobs for select to authenticated using(public.member_of(workspace_id,array['mac']));
create policy result_read on public.analysis_results for select to authenticated using(public.member_of(workspace_id,array['mac']));
create policy result_create on public.analysis_results for insert to authenticated with check(public.member_of(workspace_id,array['mac']) and exists(select 1 from public.measurement_sessions s where s.id=session_id and s.workspace_id=analysis_results.workspace_id));
create policy experiments_owner on public.experiments for all to authenticated using(public.owns_workspace(workspace_id)) with check(public.owns_workspace(workspace_id));
create policy settings_read on public.project_settings for select to authenticated using(public.member_of(workspace_id,array['mac','recorder']));
create policy settings_write on public.project_settings for all to authenticated using(public.owns_workspace(workspace_id)) with check(public.owns_workspace(workspace_id));

create function public.begin_pairing(device_name text, device_kind text) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text; did uuid;
begin
 if auth.uid() is null or device_kind not in ('mac','recorder','tv') or length(device_name) not between 1 and 120 then raise exception 'invalid pairing'; end if;
 if (select count(*) from public.devices where auth_user_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'pairing rate limit'; end if;
 code := upper(encode(extensions.gen_random_bytes(6),'hex'));
 insert into public.devices(auth_user_id,name,kind,pairing_hash,pairing_expires) values(auth.uid(),device_name,device_kind,encode(extensions.digest(code,'sha256'),'hex'),now()+interval '10 minutes') returning id into did;
 return jsonb_build_object('deviceId',did,'code',code,'expiresIn',600);
end $$;
create function public.approve_pairing(w uuid, code text) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
 if not public.owns_workspace(w) then raise exception 'forbidden'; end if;
 update public.devices set workspace_id=w,pairing_hash=null,pairing_expires=null where workspace_id is null and pairing_expires>now() and pairing_hash=encode(extensions.digest(upper(code),'sha256'),'hex') returning id into did;
 if did is null then raise exception 'expired or invalid code'; end if; return did;
end $$;
create function public.revoke_device(d uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.devices where id=d and public.owns_workspace(workspace_id)) then raise exception 'forbidden'; end if;
 update public.devices set revoked_at=now() where id=d;
 update public.commands set lease_until=now(),expires_at=now() where target_device_id=d;
end $$;
create function public.device_heartbeat(d uuid, caps jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.controls_device(d) then raise exception 'forbidden'; end if;
 update public.devices set last_seen=now(),capabilities=coalesce(caps,capabilities) where id=d;
end $$;
create function public.issue_command(sid uuid, target uuid, requested_action text, body jsonb default '{}', command_id uuid default gen_random_uuid()) returns public.commands language plpgsql security definer set search_path='' as $$
declare s public.measurement_sessions; c public.commands;
begin
 select * into s from public.measurement_sessions where id=sid for update;
 if s.id is null or not public.owns_workspace(s.workspace_id) then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.devices where id=target and workspace_id=s.workspace_id and revoked_at is null and kind in ('mac','tv')) then raise exception 'invalid target'; end if;
 select * into c from public.commands where id=command_id;
 if c.id is not null then
   if c.session_id<>sid or c.target_device_id<>target or c.action<>requested_action then raise exception 'idempotency conflict'; end if;
   return c;
 end if;
 if requested_action='start' then
   if s.state<>'armed' or not exists(select 1 from public.commands where session_id=sid and target_device_id=target and generation=s.generation and action='prepare' and acknowledged_at is not null and expires_at>now() and result->>'ready'='true') or (body->>'captureReady') is distinct from 'true' then raise exception 'not armed'; end if;
 elsif requested_action='prepare' and s.state not in ('draft','preparing') then raise exception 'invalid transition';
 elsif requested_action not in ('prepare','start','stop','analyze') then raise exception 'invalid action'; end if;
 if requested_action='stop' then update public.commands set lease_until=now(),expires_at=now() where session_id=sid; end if;
 insert into public.commands(id,session_id,target_device_id,generation,action,payload) values(command_id,sid,target,s.generation,requested_action,body) returning * into c;
 update public.measurement_sessions set state=case requested_action when 'prepare' then 'preparing' when 'start' then 'playing' when 'stop' then 'interrupted' else state end,updated_at=now() where id=sid;
 return c;
end $$;
create function public.renew_lease(cid uuid) returns timestamptz language plpgsql security definer set search_path='' as $$
declare until_at timestamptz;
begin
 update public.commands c set lease_until=now()+interval '5 seconds' from public.measurement_sessions s,public.devices d
 where c.id=cid and c.session_id=s.id and d.id=c.target_device_id and d.revoked_at is null and public.owns_workspace(s.workspace_id)
 and c.generation=s.generation and c.action='start' and s.state='playing' and c.lease_until>now()
 returning c.lease_until into until_at;
 if until_at is null then raise exception 'expired lease'; end if; return until_at;
end $$;
create function public.ack_command(cid uuid, response jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.commands;
begin
 select * into c from public.commands where id=cid for update;
 if c.id is null or not public.controls_device(c.target_device_id) then raise exception 'forbidden'; end if;
 if c.acknowledged_at is not null then return; end if;
 if c.expires_at<=now() then raise exception 'expired command'; end if;
 update public.commands set acknowledged_at=now(),result=response where id=cid;
 if c.action='prepare' and response->>'ready'='true' then update public.measurement_sessions set state='armed',updated_at=now() where id=c.session_id and state='preparing' and generation=c.generation; end if;
end $$;
create function public.finalize_artifact(aid uuid, info jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.artifacts; part jsonb; jid uuid; idx integer:=0; total_bytes bigint:=0; object_bytes bigint;
begin
 select * into a from public.artifacts where id=aid for update;
 if a.id is null or not public.member_of(a.workspace_id,array['mac','recorder']) or not (a.created_by=auth.uid() or public.owns_workspace(a.workspace_id)) then raise exception 'forbidden'; end if;
 if a.status<>'uploading' then select id into jid from public.analysis_jobs where artifact_id=aid; return jid; end if;
 if jsonb_typeof(info->'parts') is distinct from 'array' then raise exception 'empty manifest'; end if;
 if jsonb_array_length(info->'parts') not between 1 and 20000 or info->>'schemaVersion' is distinct from '1' then raise exception 'invalid manifest'; end if;
 if info->'context' is distinct from (select context from public.measurement_sessions where id=a.session_id) then raise exception 'manifest context differs from session'; end if;
 for part in select * from jsonb_array_elements(info->'parts') loop
   if part->>'path' is null or part->>'path' not like a.workspace_id::text||'/'||a.id::text||'/%' or part->>'path' like '%..%' or coalesce(part->>'sha256','') !~ '^[a-f0-9]{64}$' or (part->>'index')::integer is distinct from idx or coalesce((part->>'bytes')::bigint,0) not between 1 and 52428800 then raise exception 'invalid object metadata'; end if;
   select (metadata->>'size')::bigint into object_bytes from storage.objects where bucket_id='acoustic-artifacts' and name=part->>'path';
   if object_bytes is distinct from (part->>'bytes')::bigint then raise exception 'missing object or byte count mismatch'; end if;
   total_bytes:=total_bytes+object_bytes;idx:=idx+1;
 end loop;
 if total_bytes>536870912 then raise exception 'artifact exceeds analysis limit'; end if;
 if info->>'encoding'='float32-le' and (coalesce((info->>'frames')::bigint,0)*4<>total_bytes or coalesce((info->>'sampleRate')::integer,0) not between 8000 and 384000) then raise exception 'PCM frame count or rate mismatch'; end if;
 update public.artifacts set manifest=info,status='ready' where id=aid;
 if a.kind in ('capture','impulse') and info->>'complete'='true' then
  insert into public.analysis_jobs(workspace_id,session_id,artifact_id) values(a.workspace_id,a.session_id,aid) returning id into jid;
  update public.measurement_sessions set state='captured',updated_at=now() where id=a.session_id;
 end if;
 return jid;
end $$;
create function public.claim_analysis(d uuid) returns setof public.analysis_jobs language plpgsql security definer set search_path='' as $$
declare j public.analysis_jobs;
begin
 if not public.controls_device(d) or not exists(select 1 from public.devices where id=d and kind='mac') then raise exception 'forbidden'; end if;
 select jobs.* into j from public.analysis_jobs jobs join public.devices dev on dev.workspace_id=jobs.workspace_id
 where dev.id=d and (jobs.state='queued' or (jobs.state='running' and jobs.lease_until<now())) order by jobs.created_at for update of jobs skip locked limit 1;
 if j.id is null then return; end if;
 update public.analysis_jobs set state='running',worker_id=d,lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
 return next j;
end $$;
create function public.finish_analysis(jid uuid, result_data jsonb, failure text default null) returns void language plpgsql security definer set search_path='' as $$
declare j public.analysis_jobs;
begin
 select * into j from public.analysis_jobs where id=jid for update;
 if j.id is null or j.state<>'running' or j.lease_until<=now() or not public.controls_device(j.worker_id) then raise exception 'invalid worker lease'; end if;
 if failure is null then
  if result_data->>'sessionId' is distinct from j.session_id::text or result_data->>'rawArtifactId' is distinct from j.artifact_id::text or result_data->>'schemaVersion' is distinct from '1' then raise exception 'result session mismatch'; end if;
  insert into public.analysis_results(id,workspace_id,session_id,artifact_id,version,data) values((result_data->>'id')::uuid,j.workspace_id,j.session_id,j.artifact_id,result_data->>'version',result_data);
  update public.artifacts set status='verified' where id=j.artifact_id;
 else
  update public.artifacts set status='invalid' where id=j.artifact_id;
 end if;
 update public.analysis_jobs set state=case when failure is null then 'complete' else 'failed' end,error=failure,lease_until=null where id=jid;
 update public.measurement_sessions set state=case when failure is null then 'complete' else 'interrupted' end,updated_at=now() where id=j.session_id;
end $$;

insert into storage.buckets(id,name,public,file_size_limit) values('acoustic-artifacts','acoustic-artifacts',false,52428800) on conflict(id) do nothing;
create policy acoustic_object_read on storage.objects for select to authenticated using(bucket_id='acoustic-artifacts' and exists(select 1 from public.artifacts a where a.workspace_id::text=split_part(name,'/',1) and a.id::text=split_part(name,'/',2)));
create policy acoustic_object_insert on storage.objects for insert to authenticated with check(bucket_id='acoustic-artifacts' and exists(select 1 from public.artifacts a where a.workspace_id::text=split_part(name,'/',1) and a.id::text=split_part(name,'/',2) and a.status='uploading' and (a.created_by=auth.uid() or public.owns_workspace(a.workspace_id))));

create policy acoustic_realtime_read on realtime.messages for select to authenticated using(extension='broadcast' and exists(select 1 from public.workspaces w where 'acoustic:'||w.id::text=realtime.topic() and public.member_of(w.id)));
create function public.notify_acoustic_change() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 if tg_table_name='commands' then select workspace_id into w from public.measurement_sessions where id=new.session_id; else w:=new.workspace_id; end if;
 perform realtime.send(jsonb_build_object('table',tg_table_name,'id',new.id),'changed','acoustic:'||w::text,true);
 return new;
end $$;
create trigger command_notify after insert or update on public.commands for each row execute function public.notify_acoustic_change();
create trigger result_notify after insert on public.analysis_results for each row execute function public.notify_acoustic_change();
create trigger session_notify after update on public.measurement_sessions for each row execute function public.notify_acoustic_change();

revoke all on public.workspaces,public.devices,public.measurement_sessions,public.commands,public.artifacts,public.analysis_jobs,public.analysis_results,public.experiments,public.project_settings from anon,authenticated;
grant select,insert on public.workspaces,public.measurement_sessions,public.artifacts,public.analysis_results to authenticated;
grant select on public.devices,public.commands,public.analysis_jobs to authenticated;
grant select,insert,update,delete on public.experiments,public.project_settings to authenticated;
revoke execute on function public.owns_workspace(uuid),public.member_of(uuid,text[]),public.controls_device(uuid),public.begin_pairing(text,text),public.approve_pairing(uuid,text),public.revoke_device(uuid),public.device_heartbeat(uuid,jsonb),public.issue_command(uuid,uuid,text,jsonb,uuid),public.renew_lease(uuid),public.ack_command(uuid,jsonb),public.finalize_artifact(uuid,jsonb),public.claim_analysis(uuid),public.finish_analysis(uuid,jsonb,text),public.notify_acoustic_change() from public,anon;
grant execute on function public.owns_workspace(uuid),public.member_of(uuid,text[]),public.controls_device(uuid),public.begin_pairing(text,text),public.approve_pairing(uuid,text),public.revoke_device(uuid),public.device_heartbeat(uuid,jsonb),public.issue_command(uuid,uuid,text,jsonb,uuid),public.renew_lease(uuid),public.ack_command(uuid,jsonb),public.finalize_artifact(uuid,jsonb),public.claim_analysis(uuid),public.finish_analysis(uuid,jsonb,text) to authenticated;
commit;
