-- VOS Suite MVP (VOSS) — 0001_init_schema.sql
-- Source of truth: S11 (E&M), D02, D03, S06, S01–S03, S08, S07 rollups
-- NOTE: RLS intentionally left OFF for MVP speed. Lock down later.

begin;

-- Extensions (safe to run repeatedly)
create extension if not exists pgcrypto with schema public;
create extension if not exists citext with schema public;

-- =========================
-- Core
-- =========================
create table if not exists public.vessels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'UTC',
  imo_or_reg text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profile (
  id uuid primary key, -- should match auth.users.id later
  display_name text not null,
  dept text null,
  created_at timestamptz not null default now()
);

-- =========================
-- S11 E&M: Equipment Master
-- =========================
create table if not exists public.equipment_type (
  id uuid primary key default gen_random_uuid(),
  code citext not null unique, -- e.g. DIESEL_GENERATOR
  name text not null,
  category text not null,
  default_criticality text not null default 'med',
  typical_instance_min int not null default 0,
  typical_instance_max int not null default 1,
  is_high_count boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_system (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.location (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  name text not null,
  parent_location_id uuid null references public.location(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_instance (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  type_id uuid not null references public.equipment_type(id) on delete restrict,

  display_name text not null,
  manufacturer text null,
  model text null,
  serial_no text null,

  system_id uuid null references public.equipment_system(id) on delete set null,
  location_id uuid null references public.location(id) on delete set null,
  parent_equipment_id uuid null references public.equipment_instance(id) on delete set null,

  criticality text not null default 'med',
  operational_state text null,
  maintenance_state text null,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_equipment_instance_vessel on public.equipment_instance(vessel_id);
create index if not exists idx_equipment_instance_type on public.equipment_instance(type_id);
create index if not exists idx_equipment_instance_system on public.equipment_instance(system_id);

-- =========================
-- D03: Field template engine
-- =========================
create table if not exists public.field_definition (
  id uuid primary key default gen_random_uuid(),
  code citext not null unique, -- e.g. ME_HOURS, BUS_VOLTAGE
  name text not null,
  canonical_unit text not null,
  input_type text not null, -- number/toggle/select/text
  options_json jsonb null,
  expected_min numeric null,
  expected_max numeric null,
  default_log_enabled boolean not null default false,
  severity text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_type_field_map (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.equipment_type(id) on delete cascade,
  field_id uuid not null references public.field_definition(id) on delete cascade,
  default_log_enabled boolean not null default true,
  default_group text not null default 'General',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (type_id, field_id)
);

create index if not exists idx_type_field_map_type on public.equipment_type_field_map(type_id);

create table if not exists public.equipment_instance_field_override (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_instance(id) on delete cascade,
  field_id uuid not null references public.field_definition(id) on delete cascade,

  log_enabled boolean null, -- null = inherit from type map
  label_override text null,
  expected_min_override numeric null,
  expected_max_override numeric null,
  unit_override text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (equipment_id, field_id)
);

create index if not exists idx_instance_field_override_equipment on public.equipment_instance_field_override(equipment_id);

-- =========================
-- S06: Daily Logs + readings (rule: equipment_id + field_id + timestamp + source/context_id)
-- =========================
create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  log_date date not null,
  status text not null default 'dock', -- dock/underway/anchor/shipyard
  location_text text null,
  lat numeric null,
  lon numeric null,
  weather_text text null,
  notes text null,
  created_by uuid null,
  submitted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vessel_id, log_date)
);

create index if not exists idx_daily_logs_vessel_date on public.daily_logs(vessel_id, log_date);

-- Widget cache: deterministic widgets from log_enabled fields, cached per log
create table if not exists public.daily_log_widget_cache (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  layout_json jsonb not null,
  generated_at timestamptz not null default now(),
  unique (daily_log_id)
);

-- Canonical readings table (D03/S06)
create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_instance(id) on delete cascade,
  field_id uuid not null references public.field_definition(id) on delete restrict,

  value jsonb not null, -- store numeric/bool/text/select in one column
  unit text null,

  recorded_at timestamptz not null default now(),
  source text not null, -- DAILY_LOG / WORK_ORDER / MANUAL / RUNNING_LOG
  context_id uuid null, -- daily_log_id / work_order_id / etc.
  created_by uuid null,

  created_at timestamptz not null default now()
);

create index if not exists idx_meter_readings_equipment_time on public.meter_readings(equipment_id, recorded_at desc);
create index if not exists idx_meter_readings_field_time on public.meter_readings(field_id, recorded_at desc);
create index if not exists idx_meter_readings_source_context on public.meter_readings(source, context_id);

-- Unified events stream (D03)
create table if not exists public.equipment_events (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_instance(id) on delete cascade,
  event_type text not null,
  severity text not null default 'normal',
  occurred_at timestamptz not null default now(),
  notes text null,
  source text not null default 'MANUAL',
  context_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_events_equipment_time on public.equipment_events(equipment_id, occurred_at desc);

-- =========================
-- S01: Defects (can only create WO Requested)
-- =========================
create table if not exists public.defects (
  id uuid primary key default gen_random_uuid(),
  defect_no citext not null unique,
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  equipment_id uuid null references public.equipment_instance(id) on delete set null,

  title text not null,
  department text null,
  location_text text null,
  nature text null,
  priority text not null default 'med',

  reported_by text null,
  reviewed boolean not null default false,
  wo_requested boolean not null default false,
  linked_work_order_id uuid null,

  status text not null default 'unreviewed', -- unreviewed/reviewed/wo_requested/closed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_defects_vessel_status on public.defects(vessel_id, status);

-- =========================
-- S02: Work Orders / Tasks
-- =========================
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  wo_no citext not null unique,
  vessel_id uuid not null references public.vessels(id) on delete cascade,

  source text not null default 'MANUAL', -- DEFECT / PM / MANUAL
  source_id uuid null,

  equipment_id uuid null references public.equipment_instance(id) on delete set null,

  priority text not null default 'med',
  primary_status text not null default 'WO Requested', -- WO Requested / WO Open / Closed Report Pending / Deferred
  secondary_state text null,

  tagout_required boolean not null default false,
  permit_required boolean not null default false,

  title text not null,
  scope_summary text null,

  created_at timestamptz not null default now(),
  closed_at timestamptz null
);

create index if not exists idx_work_orders_vessel_status on public.work_orders(vessel_id, primary_status);
create index if not exists idx_work_orders_equipment on public.work_orders(equipment_id);

-- link defects → work orders
alter table public.defects
  add constraint defects_linked_work_order_fk
  foreign key (linked_work_order_id) references public.work_orders(id) on delete set null;

-- MVP-light tasks (optional; can be merged later)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_no citext not null unique,
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  equipment_id uuid null references public.equipment_instance(id) on delete set null,

  source text not null default 'MANUAL',
  source_id uuid null,

  title text not null,
  due_at timestamptz null,
  status text not null default 'open', -- open/complete/cancelled
  completed_at timestamptz null,
  completed_by uuid null,
  notes text null,

  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_vessel_status on public.tasks(vessel_id, status);

-- =========================
-- S03: WOT Reports (gate: Closed work stays report pending until report submitted)
-- =========================
create table if not exists public.wot_reports (
  id uuid primary key default gen_random_uuid(),
  report_no citext not null unique,

  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  submitted_by uuid null,

  work_summary text not null,
  outcome text not null default 'Resolved', -- Resolved/Mitigated/Not resolved
  tests_json jsonb null,
  root_cause text null,
  labor_minutes int null,
  cost_total numeric null,

  created_at timestamptz not null default now(),
  unique (work_order_id)
);

-- =========================
-- S08: Archive (immutable)
-- =========================
create table if not exists public.archive_records (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,

  record_type text not null, -- WOT_REPORT/WO/DEFECT/EXPORT_PACK/etc
  source_table text not null,
  source_id uuid not null,

  immutable_payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_archive_records_vessel_type_time on public.archive_records(vessel_id, record_type, created_at desc);

create table if not exists public.activities_log (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  actor_id uuid null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  reason text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_activities_vessel_time on public.activities_log(vessel_id, created_at desc);

create table if not exists public.export_packs (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  name text not null,
  date_from date null,
  date_to date null,
  sections_json jsonb not null default '{}'::jsonb,
  file_ref text null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

-- =========================
-- S07: DOS cached rollups (do not recompute heavy widgets every load)
-- =========================
create table if not exists public.dos_rollup_daily (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels(id) on delete cascade,
  rollup_date date not null,
  counters_json jsonb not null default '{}'::jsonb,
  usage_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (vessel_id, rollup_date)
);

commit;