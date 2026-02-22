begin;

-- 1) vessels(name) unique (enables ON CONFLICT (name))
create unique index if not exists ux_vessels_name
on public.vessels (name);

-- 2) equipment_system unique per vessel
create unique index if not exists ux_equipment_system_vessel_name
on public.equipment_system (vessel_id, name);

-- 3) location unique per vessel
create unique index if not exists ux_location_vessel_name
on public.location (vessel_id, name);

commit;