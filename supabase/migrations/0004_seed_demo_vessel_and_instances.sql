begin;

-- Demo vessel + minimal structure + starter equipment instances
-- Safe to rerun: uses ON CONFLICT and "delete+reseed demo-only" pattern.

-- 1) Vessel
insert into public.vessels (name, timezone, imo_or_reg, notes)
values ('DEMO VESSEL', 'UTC', null, 'Demo vessel for VOS Suite MVP')
on conflict (name) do update set
  timezone = excluded.timezone,
  notes = excluded.notes,
  updated_at = now();

-- Grab demo vessel id
with v as (
  select id as vessel_id from public.vessels where name = 'DEMO VESSEL' limit 1
)

-- 2) Systems (minimal)
insert into public.equipment_system (vessel_id, name, sort_order)
select v.vessel_id, s.name, s.sort_order
from v
join (values
  ('Propulsion', 10),
  ('Electrical Generation', 20),
  ('Electrical', 30),
  ('Bilge & Dewatering', 40),
  ('Fire & Safety', 50),
  ('HVAC/Chillers', 60),
  ('Compressed Air', 70),
  ('Fuel', 80),
  ('Fresh Water', 90)
) as s(name, sort_order) on true
on conflict do nothing;

-- 3) Locations (minimal)
with v as (
  select id as vessel_id from public.vessels where name = 'DEMO VESSEL' limit 1
)
insert into public.location (vessel_id, name, parent_location_id, sort_order)
select v.vessel_id, l.name, null, l.sort_order
from v
join (values
  ('Engine Room', 10),
  ('ER - Port', 20),
  ('ER - Stbd', 30),
  ('Lazarette', 40),
  ('Bridge', 50)
) as l(name, sort_order) on true
on conflict do nothing;

-- 4) Remove prior demo equipment instances (only for this demo vessel)
-- This keeps re-runs clean without touching other vessels.
with v as (
  select id as vessel_id from public.vessels where name = 'DEMO VESSEL' limit 1
)
delete from public.equipment_instance ei
using v
where ei.vessel_id = v.vessel_id
  and ei.display_name like 'DEMO:%';

-- 5) Insert starter equipment instances by type
-- Counts chosen as sensible demo defaults:
-- ME x1, DG x2, Shore x1, Battery x1, UPS x1, Bilge Pump x2, Fire Pump x1,
-- Air Compressor x1, Chiller x1, A/C Pump x2, Fuel Transfer x1, Watermaker x1

with v as (
  select id as vessel_id from public.vessels where name = 'DEMO VESSEL' limit 1
),
sys as (
  select es.vessel_id, es.id, es.name
  from public.equipment_system es
  join v on v.vessel_id = es.vessel_id
),
loc as (
  select l.vessel_id, l.id, l.name
  from public.location l
  join v on v.vessel_id = l.vessel_id
),
et as (
  select id, code, name, category from public.equipment_type
),
to_insert as (
  select * from (values
    ('MAIN_ENGINE',         'DEMO: Main Engine 1',         'Propulsion',            'Engine Room'),
    ('DIESEL_GENERATOR',    'DEMO: DG 1',                  'Electrical Generation', 'Engine Room'),
    ('DIESEL_GENERATOR',    'DEMO: DG 2',                  'Electrical Generation', 'Engine Room'),
    ('SHORE_POWER',         'DEMO: Shore Power',           'Electrical',            'Engine Room'),
    ('BATTERY_BANK',        'DEMO: Battery Bank',          'Electrical',            'Engine Room'),
    ('UPS_SYSTEM',          'DEMO: UPS',                   'Electrical',            'Bridge'),

    ('BILGE_PUMP',          'DEMO: Bilge Pump 1',          'Bilge & Dewatering',    'ER - Port'),
    ('BILGE_PUMP',          'DEMO: Bilge Pump 2',          'Bilge & Dewatering',    'ER - Stbd'),

    ('FIRE_PUMP',           'DEMO: Fire Pump',             'Fire & Safety',         'Engine Room'),

    ('AIR_COMPRESSOR',      'DEMO: Air Compressor',        'Compressed Air',        'Engine Room'),

    ('CHILLER_UNIT',        'DEMO: Chiller 1',             'HVAC/Chillers',          'Engine Room'),
    ('AC_PUMP',             'DEMO: A/C Pump 1',            'HVAC/Chillers',          'Engine Room'),
    ('AC_PUMP',             'DEMO: A/C Pump 2',            'HVAC/Chillers',          'Engine Room'),

    ('FUEL_TRANSFER_PUMP',  'DEMO: Fuel Transfer Pump',    'Fuel',                  'Engine Room'),

    ('WATERMAKER',          'DEMO: Watermaker',            'Fresh Water',           'Engine Room')
  ) as x(type_code, display_name, system_name, location_name)
)
insert into public.equipment_instance
(vessel_id, type_id, display_name, system_id, location_id, criticality, operational_state, maintenance_state, active)
select
  v.vessel_id,
  et.id as type_id,
  ti.display_name,
  sys.id as system_id,
  loc.id as location_id,
  et2.default_criticality,
  'Operational' as operational_state,
  'In Service' as maintenance_state,
  true
from v
join to_insert ti on true
join public.equipment_type et2 on et2.code = ti.type_code
join et on et.code = ti.type_code
left join sys on sys.vessel_id = v.vessel_id and sys.name = ti.system_name
left join loc on loc.vessel_id = v.vessel_id and loc.name = ti.location_name;

commit;