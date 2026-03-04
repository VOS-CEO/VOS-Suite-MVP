begin;

-- Ensure Engine Room sub-locations exist and are parented correctly for the DEMO VESSEL.
with v as (
  select id as vessel_id
  from public.vessels
  where name = 'DEMO VESSEL'
  limit 1
),
er as (
  select l.id as engine_room_id, v.vessel_id
  from v
  join public.location l
    on l.vessel_id = v.vessel_id
   and l.name = 'Engine Room'
  limit 1
)
-- 1) Ensure ER - Center exists (child of Engine Room)
insert into public.location (vessel_id, name, parent_location_id, sort_order)
select er.vessel_id, 'ER - Center', er.engine_room_id, 25
from er
where not exists (
  select 1 from public.location l
  where l.vessel_id = er.vessel_id
    and l.name = 'ER - Center'
);

-- 2) Ensure ER - Port and ER - Stbd are children of Engine Room (not top-level)
with v as (
  select id as vessel_id
  from public.vessels
  where name = 'DEMO VESSEL'
  limit 1
),
er as (
  select l.id as engine_room_id, v.vessel_id
  from v
  join public.location l
    on l.vessel_id = v.vessel_id
   and l.name = 'Engine Room'
  limit 1
)
update public.location l
set parent_location_id = er.engine_room_id
from er
where l.vessel_id = er.vessel_id
  and l.name in ('ER - Port','ER - Stbd','ER - Center')
  and (l.parent_location_id is distinct from er.engine_room_id);

-- 3) Assign demo equipment locations (ME1/DG1 -> Port, ME2/DG2 -> Stbd, Shore -> Center)
with v as (
  select id as vessel_id
  from public.vessels
  where name = 'DEMO VESSEL'
  limit 1
),
loc as (
  select
    v.vessel_id,
    (select id from public.location where vessel_id=v.vessel_id and name='ER - Port' limit 1) as er_port,
    (select id from public.location where vessel_id=v.vessel_id and name='ER - Stbd' limit 1) as er_stbd,
    (select id from public.location where vessel_id=v.vessel_id and name='ER - Center' limit 1) as er_center
  from v
)
update public.equipment_instance ei
set location_id = case
  when ei.display_name = 'DEMO: Main Engine 1' then loc.er_port
  when ei.display_name = 'DEMO: Main Engine 2' then loc.er_stbd
  when ei.display_name = 'DEMO: DG 1' then loc.er_port
  when ei.display_name = 'DEMO: DG 2' then loc.er_stbd
  when ei.display_name = 'DEMO: Shore Power' then loc.er_center
  else ei.location_id
end
from loc
where ei.vessel_id = loc.vessel_id
  and ei.display_name in (
    'DEMO: Main Engine 1',
    'DEMO: Main Engine 2',
    'DEMO: DG 1',
    'DEMO: DG 2',
    'DEMO: Shore Power'
  );

commit;