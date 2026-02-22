begin;

-- Makes seed scripts safe to rerun with ON CONFLICT
-- 1) Vessel name unique (so ON CONFLICT (name) works)
alter table public.vessels
  add constraint if not exists vessels_name_unique unique (name);

-- 2) Prevent duplicate systems per vessel
alter table public.equipment_system
  add constraint if not exists equipment_system_unique_per_vessel unique (vessel_id, name);

-- 3) Prevent duplicate locations per vessel
alter table public.location
  add constraint if not exists location_unique_per_vessel unique (vessel_id, name);

commit;