begin;

-- D03: Field definitions (starter set)
-- We keep codes stable and idempotent.

insert into public.field_definition
(code, name, canonical_unit, input_type, options_json, expected_min, expected_max, default_log_enabled, severity)
values
  -- Hours
  ('RUN_HOURS',      'Run Hours',           'hours', 'number', null, null, null, true,  'normal'),
  ('STARTS',         'Starts Count',        'count', 'number', null, 0,    null, false, 'normal'),

  -- Electrical
  ('BUS_VOLTAGE',    'Bus Voltage',         'V',     'number', null, 0,    null, true,  'warning'),
  ('BUS_FREQUENCY',  'Bus Frequency',       'Hz',    'number', null, 0,    null, true,  'warning'),
  ('BANK_VOLTAGE',   'Battery Bank Voltage','V',     'number', null, 0,    null, true,  'warning'),
  ('BANK_SOC',       'Battery SOC',         '%',     'number', null, 0,    100,  true,  'warning'),
  ('UPS_STATUS',     'UPS Status',          'state', 'select',
    '{"options":["OK","On Battery","Fault"]}'::jsonb, null, null, true, 'warning'),

  -- Pumps / status
  ('PUMP_STATUS',    'Pump Status',         'state', 'select',
    '{"options":["Off","Auto","Running","Fault"]}'::jsonb, null, null, true, 'warning'),

  -- HVAC
  ('CH_STATUS',      'Chiller Status',      'state', 'select',
    '{"options":["Off","Running","Fault","Lockout"]}'::jsonb, null, null, true, 'warning'),
  ('CH_SUPPLY_TEMP', 'Chilled Water Supply','°C',    'number', null, -5,  30,   true, 'warning'),

  -- Location/ops quick notes (example text field)
  ('NOTE',           'Note',                'text',  'text',   null, null, null, false,'normal')

on conflict (code) do update set
  name = excluded.name,
  canonical_unit = excluded.canonical_unit,
  input_type = excluded.input_type,
  options_json = excluded.options_json,
  expected_min = excluded.expected_min,
  expected_max = excluded.expected_max,
  default_log_enabled = excluded.default_log_enabled,
  severity = excluded.severity,
  updated_at = now();

-- Helper CTEs for mapping
with et as (
  select id, code from public.equipment_type
),
fd as (
  select id, code from public.field_definition
)
insert into public.equipment_type_field_map
(type_id, field_id, default_log_enabled, default_group, sort_order)
select
  et.id,
  fd.id,
  true,
  m.default_group,
  m.sort_order
from (
  values
    -- Main Engine
    ('MAIN_ENGINE',      'RUN_HOURS',     'Propulsion',             10),
    ('MAIN_ENGINE',      'STARTS',        'Propulsion',             20),

    -- Generator
    ('DIESEL_GENERATOR', 'RUN_HOURS',     'Electrical Generation',  10),
    ('DIESEL_GENERATOR', 'BUS_VOLTAGE',   'Electrical Generation',  20),
    ('DIESEL_GENERATOR', 'BUS_FREQUENCY', 'Electrical Generation',  30),

    -- Shore Power
    ('SHORE_POWER',      'BUS_VOLTAGE',   'Electrical',             10),
    ('SHORE_POWER',      'BUS_FREQUENCY', 'Electrical',             20),

    -- Battery / UPS
    ('BATTERY_BANK',     'BANK_VOLTAGE',  'Electrical',             10),
    ('BATTERY_BANK',     'BANK_SOC',      'Electrical',             20),
    ('UPS_SYSTEM',       'UPS_STATUS',    'Electrical',             30),

    -- Bilge / Fire / Transfer pumps
    ('BILGE_PUMP',       'PUMP_STATUS',   'Bilges & Dewatering',    10),
    ('BILGE_PUMP',       'RUN_HOURS',     'Bilges & Dewatering',    20),
    ('FIRE_PUMP',        'PUMP_STATUS',   'Fire & Safety',          10),
    ('FUEL_TRANSFER_PUMP','PUMP_STATUS',  'Fuel',                   10),

    -- Air / HVAC
    ('AIR_COMPRESSOR',   'PUMP_STATUS',   'Compressed Air',         10),
    ('AIR_COMPRESSOR',   'RUN_HOURS',     'Compressed Air',         20),
    ('CHILLER_UNIT',     'CH_STATUS',     'HVAC/Chillers',          10),
    ('CHILLER_UNIT',     'CH_SUPPLY_TEMP','HVAC/Chillers',          20),
    ('AC_PUMP',          'PUMP_STATUS',   'HVAC/Chillers',          30),
    ('AC_PUMP',          'RUN_HOURS',     'HVAC/Chillers',          40),

    -- Watermaker
    ('WATERMAKER',       'PUMP_STATUS',   'Fresh Water',            10),
    ('WATERMAKER',       'RUN_HOURS',     'Fresh Water',            20)
) as m(type_code, field_code, default_group, sort_order)
join et on et.code = m.type_code
join fd on fd.code = m.field_code
on conflict (type_id, field_id) do update set
  default_log_enabled = excluded.default_log_enabled,
  default_group = excluded.default_group,
  sort_order = excluded.sort_order;

commit;