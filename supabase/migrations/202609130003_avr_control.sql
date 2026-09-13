-- AVR control is restricted to the workspace owner and one explicitly assigned Mac.
-- Recorders and TVs do not inherit this privilege from workspace membership.
create table public.avr_receivers (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 mac_device_id uuid not null references public.devices(id),
 name text not null check(length(name) between 1 and 120),
 created_at timestamptz not null default now()
);
create function public.avr_is_mac(r uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.avr_receivers a join public.devices d on d.id=a.mac_device_id
 where a.id=r and d.workspace_id=a.workspace_id and d.kind='mac' and d.revoked_at is null and d.auth_user_id=auth.uid());
$$;
create function public.avr_can_read(r uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.avr_receivers a where a.id=r and (public.owns_workspace(a.workspace_id) or public.avr_is_mac(a.id)));
$$;
create table public.avr_observations (
 receiver_id uuid primary key references public.avr_receivers(id) on delete cascade,
 observed_at timestamptz not null,
 received_at timestamptz not null default now(),
 revision text not null check(length(revision)=64),
 state jsonb not null check(jsonb_typeof(state)='object'),
 measurement jsonb,
 preset jsonb
);
create table public.avr_operations (
 id uuid primary key,
 receiver_id uuid not null references public.avr_receivers(id),
 requested_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '10 seconds'),
 expected_revision text not null,
 kind text not null check(kind in ('power','mute','volume','volume-up','volume-down','source','surround','channel-levels','reset-channels','import-preset','center-boost','restore-preset','measurement-begin','measurement-renew','measurement-end','read','snapshot')),
 body jsonb not null default '{}' check(jsonb_typeof(body)='object' and octet_length(body::text)<65536),
 completed_at timestamptz,
 outcome jsonb,
 check(expires_at>created_at and expires_at<=created_at+interval '10 seconds')
);
create index avr_pending on public.avr_operations(receiver_id,created_at) where completed_at is null;
create table public.avr_snapshots (
 id uuid primary key,
 receiver_id uuid not null references public.avr_receivers(id),
 created_at timestamptz not null default now(),
 purpose text not null check(purpose in ('manual','measurement-before','measurement-after','diagnostic')),
 state jsonb not null,
 revision text not null,
 raw_path text,
 raw_sha256 text check(raw_sha256 is null or raw_sha256 ~ '^[a-f0-9]{64}$'),
 measurement_id uuid
);
alter table public.avr_receivers enable row level security;
alter table public.avr_observations enable row level security;
alter table public.avr_operations enable row level security;
alter table public.avr_snapshots enable row level security;
create policy avr_receivers_read on public.avr_receivers for select to authenticated using(public.avr_can_read(id));
create policy avr_observations_read on public.avr_observations for select to authenticated using(public.avr_can_read(receiver_id));
create policy avr_operations_read on public.avr_operations for select to authenticated using(public.avr_can_read(receiver_id));
create policy avr_snapshots_read on public.avr_snapshots for select to authenticated using(public.avr_can_read(receiver_id));
create policy avr_snapshots_insert on public.avr_snapshots for insert to authenticated with check(public.avr_is_mac(receiver_id) and (raw_path is null or raw_path=receiver_id::text||'/'||id::text||'.json'));

create function public.register_avr(r uuid, d uuid, receiver_name text) returns public.avr_receivers language plpgsql security definer set search_path='' as $$
declare dev public.devices; result public.avr_receivers;
begin
 select * into dev from public.devices where id=d and kind='mac' and workspace_id is not null and revoked_at is null and (auth_user_id=auth.uid() or public.owns_workspace(workspace_id));
 if dev.id is null then raise exception 'assigned Mac required'; end if;
 insert into public.avr_receivers(id,workspace_id,mac_device_id,name) values(r,dev.workspace_id,d,receiver_name) on conflict(id) do nothing;
 select * into result from public.avr_receivers where id=r;
 if result.mac_device_id<>d or result.workspace_id<>dev.workspace_id then raise exception 'receiver assignment mismatch';end if;
 return result;
end $$;
create function public.observe_avr(r uuid, at_time timestamptz, rev text, observation jsonb, lease jsonb default null, saved_preset jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.avr_is_mac(r) then raise exception 'assigned Mac required';end if;
 if octet_length(observation::text)>1048576 or at_time>now()+interval '30 seconds' then raise exception 'invalid observation';end if;
 insert into public.avr_observations(receiver_id,observed_at,revision,state,measurement,preset) values(r,at_time,rev,observation,lease,saved_preset)
 on conflict(receiver_id) do update set observed_at=excluded.observed_at,received_at=now(),revision=excluded.revision,state=excluded.state,measurement=excluded.measurement,preset=excluded.preset;
end $$;
create function public.issue_avr_operation(r uuid, operation_id uuid, rev text, action text, payload jsonb default '{}') returns public.avr_operations language plpgsql security definer set search_path='' as $$
declare result public.avr_operations; receiver public.avr_receivers; observation public.avr_observations; emergency boolean;
begin
 select * into receiver from public.avr_receivers where id=r;
 if receiver.id is null or not public.owns_workspace(receiver.workspace_id) then raise exception 'owner required';end if;
 select * into result from public.avr_operations where id=operation_id;
 if result.id is not null then
  if result.receiver_id<>r or result.requested_by<>auth.uid() then raise exception 'operation ID conflict';end if;
  return result;
 end if;
 if not exists(select 1 from public.devices where id=receiver.mac_device_id and kind='mac' and revoked_at is null and workspace_id=receiver.workspace_id) then raise exception 'Mac revoked';end if;
 select * into observation from public.avr_observations where receiver_id=r;
 if observation.receiver_id is null or observation.received_at<now()-interval '20 seconds' then raise exception 'Mac offline; commands are not queued offline';end if;
 emergency:=(action='mute' and payload->>'enabled'='true') or (action='power' and payload->>'enabled'='false');
 if not emergency and action not in ('measurement-renew','measurement-end') and observation.revision<>rev then raise exception 'stale revision';end if;
 insert into public.avr_operations(id,receiver_id,expected_revision,kind,body) values(operation_id,r,rev,action,payload) returning * into result;
 return result;
end $$;
create function public.finish_avr_operation(operation_id uuid, response jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.avr_operations where id=operation_id and public.avr_is_mac(receiver_id)) then raise exception 'assigned Mac required';end if;
 if octet_length(response::text)>4194304 then raise exception 'response too large';end if;
 update public.avr_operations set completed_at=now(),outcome=response where id=operation_id and completed_at is null;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('avr-private','avr-private',false,8388608,array['application/json']) on conflict(id) do nothing;
create policy avr_raw_read on storage.objects for select to authenticated using(bucket_id='avr-private' and exists(select 1 from public.avr_snapshots s where s.raw_path=name and public.avr_can_read(s.receiver_id)));
create policy avr_raw_insert on storage.objects for insert to authenticated with check(bucket_id='avr-private' and exists(select 1 from public.avr_snapshots s where s.raw_path=name and public.avr_is_mac(s.receiver_id)));
revoke all on function public.register_avr(uuid,uuid,text),public.observe_avr(uuid,timestamptz,text,jsonb,jsonb,jsonb),public.issue_avr_operation(uuid,uuid,text,text,jsonb),public.finish_avr_operation(uuid,jsonb) from public,anon;
grant execute on function public.register_avr(uuid,uuid,text),public.observe_avr(uuid,timestamptz,text,jsonb,jsonb,jsonb),public.issue_avr_operation(uuid,uuid,text,text,jsonb),public.finish_avr_operation(uuid,jsonb) to authenticated;
