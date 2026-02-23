import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type FieldDef = {
  id: string;
  code: string;
  name: string;
  canonical_unit: string;
  input_type: string;
  options_json: unknown | null;
  expected_min: number | null;
  expected_max: number | null;
  severity: string;
};

type TypeFieldMapRow = {
  default_log_enabled: boolean;
  default_group: string;
  sort_order: number;
  field_definition: FieldDef;
};

type FieldOverrideRow = {
  field_id: string;
  log_enabled: boolean | null;
  label_override: string | null;
  expected_min_override: number | null;
  expected_max_override: number | null;
  unit_override: string | null;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  if (!id) {
    return NextResponse.json({ error: "Missing equipment id" }, { status: 400 });
  }

  const sb = supabaseServer();

  // 1) equipment → type_id
  const { data: eqp, error: eqErr } = await sb
    .from("equipment_instance")
    .select("id,type_id")
    .eq("id", id)
    .maybeSingle();

  if (eqErr) return NextResponse.json({ error: eqErr.message }, { status: 500 });
  if (!eqp) return NextResponse.json({ error: "Equipment not found" }, { status: 404 });

  // 2) type → mapped fields
  const { data: mapsRaw, error: mapErr } = await sb
    .from("equipment_type_field_map")
    .select(
      `
      default_log_enabled, default_group, sort_order,
      field_definition:field_definition (
        id, code, name, canonical_unit, input_type, options_json, expected_min, expected_max, severity
      )
    `
    )
    .eq("type_id", eqp.type_id)
    .order("default_group", { ascending: true })
    .order("sort_order", { ascending: true });

  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 });

  const maps = (mapsRaw ?? []) as unknown as TypeFieldMapRow[];

  // 3) equipment → overrides
  const { data: overridesRaw, error: ovErr } = await sb
    .from("equipment_instance_field_override")
    .select(
      "field_id, log_enabled, label_override, expected_min_override, expected_max_override, unit_override"
    )
    .eq("equipment_id", eqp.id);

  if (ovErr) return NextResponse.json({ error: ovErr.message }, { status: 500 });

  const overrides = (overridesRaw ?? []) as FieldOverrideRow[];
  const ovByField = new Map<string, FieldOverrideRow>();
  overrides.forEach((o) => ovByField.set(o.field_id, o));

  const items = maps.map((m) => {
    const fd = m.field_definition;
    const ov = ovByField.get(fd.id);
    const effective_log_enabled = (ov?.log_enabled ?? m.default_log_enabled) === true;

    return {
      field_id: fd.id,
      code: fd.code,
      name: ov?.label_override ?? fd.name,
      unit: ov?.unit_override ?? fd.canonical_unit,
      input_type: fd.input_type,
      options_json: fd.options_json,
      expected_min: ov?.expected_min_override ?? fd.expected_min,
      expected_max: ov?.expected_max_override ?? fd.expected_max,
      severity: fd.severity,
      group: m.default_group,
      sort_order: m.sort_order,
      default_log_enabled: m.default_log_enabled,
      override_log_enabled: ov?.log_enabled ?? null,
      effective_log_enabled,
    };
  });

  return NextResponse.json({ equipment_id: eqp.id, items });
}