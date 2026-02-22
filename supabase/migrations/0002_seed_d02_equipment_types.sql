begin;

-- D02: Global Library starter set (expand later from D02 PDF)
-- Using stable codes (citext unique) so seeds are idempotent via ON CONFLICT.

insert into public.equipment_type
(code, name, category, default_criticality, typical_instance_min, typical_instance_max, is_high_count)
values
  ('MAIN_ENGINE',        'Main Engine',               'Propulsion',            'Operational-Critical', 1, 2, false),
  ('DIESEL_GENERATOR',   'Diesel Generator',          'Electrical Generation', 'Operational-Critical', 1, 6, false),
  ('SHORE_POWER',        'Shore Power',               'Electrical',            'Operational-Critical', 0, 2, false),
  ('BATTERY_BANK',       'Battery Bank',              'Electrical',            'Safety/Statutory-Critical', 1, 6, false),
  ('UPS_SYSTEM',         'UPS System',                'Electrical',            'Safety/Statutory-Critical', 0, 6, false),

  ('BILGE_PUMP',         'Bilge Pump',                'Bilge & Dewatering',    'Safety/Statutory-Critical', 1, 12, true),
  ('FIRE_PUMP',          'Fire Pump',                 'Fire & Safety',         'Safety/Statutory-Critical', 0, 2, false),

  ('AIR_COMPRESSOR',     'Air Compressor',            'Compressed Air',        'Operational-Critical', 1, 4, false),
  ('CHILLER_UNIT',       'Chiller Unit',              'HVAC/Chillers',         'Operational-Critical', 1, 6, false),
  ('AC_PUMP',            'A/C Seawater Pump',          'HVAC/Chillers',         'Operational-Critical', 1, 6, true),

  ('FUEL_TRANSFER_PUMP', 'Fuel Transfer Pump',        'Fuel',                  'Operational-Critical', 0, 6, true),
  ('WATERMAKER',         'Watermaker',                'Fresh Water',           'Operational-Critical', 0, 4, false)

on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  default_criticality = excluded.default_criticality,
  typical_instance_min = excluded.typical_instance_min,
  typical_instance_max = excluded.typical_instance_max,
  is_high_count = excluded.is_high_count,
  updated_at = now();

commit;