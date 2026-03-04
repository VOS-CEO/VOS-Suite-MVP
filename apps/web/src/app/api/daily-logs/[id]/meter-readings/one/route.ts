import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Ctx = { params: Promise<{ id: string }> };

// Value matches your meter_readings.value JSON shape (you already use { num: hours })
type MeterValue =
  | { num: number }
  | { bool: boolean }
  | { text: string };

export async function GET(req: Request, ctx: Ctx) {
  const sb = supabaseServer();
  const { id: dailyLogId } = await ctx.params;

  const url = new URL(req.url);
  const equipmentId = url.searchParams.get("equipmentId");
  const fieldId = url.searchParams.get("fieldId");

  if (!equipmentId) return NextResponse.json({ error: "equipmentId required" }, { status: 400 });
  if (!fieldId) return NextResponse.json({ error: "fieldId required" }, { status: 400 });

  const { data, error } = await sb
    .from("meter_readings")
    .select("value,unit,recorded_at")
    .eq("context_id", dailyLogId)
    .eq("source", "DAILY_LOG")
    .eq("equipment_id", equipmentId)
    .eq("field_id", fieldId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reading: data ?? null });
}

export async function POST(req: Request, ctx: Ctx) {
  const sb = supabaseServer();
  const { id: dailyLogId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const equipmentId = body?.equipmentId as string | undefined;
  const fieldId = body?.fieldId as string | undefined;

  // Back-compat: existing UI sends { hours: number }
  const hours = body?.hours as number | undefined;

  // New: generic value payload
  const value = body?.value as MeterValue | undefined;
  const unit = (body?.unit as string | undefined) ?? (typeof hours === "number" ? "hours" : null);

  if (!equipmentId) return NextResponse.json({ error: "equipmentId required" }, { status: 400 });
  if (!fieldId) return NextResponse.json({ error: "fieldId required" }, { status: 400 });

  let finalValue: MeterValue | null = null;
  let finalUnit: string | null = unit;

  if (typeof hours === "number" && !Number.isNaN(hours)) {
    finalValue = { num: hours };
    finalUnit = finalUnit ?? "hours";
  } else if (value && typeof value === "object") {
    // Validate allowed shapes
    if ("num" in value && typeof value.num === "number" && !Number.isNaN(value.num)) finalValue = { num: value.num };
    else if ("bool" in value && typeof value.bool === "boolean") finalValue = { bool: value.bool };
    else if ("text" in value && typeof value.text === "string") finalValue = { text: value.text };
  }

  if (!finalValue) {
    return NextResponse.json(
      { error: "Provide either { hours:number } or { value:{num|bool|text}, unit? }" },
      { status: 400 }
    );
  }

  // Block edits after submit
  const { data: log, error: lErr } = await sb
    .from("daily_logs")
    .select("id,submitted_at")
    .eq("id", dailyLogId)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!log) return NextResponse.json({ error: "Daily log not found" }, { status: 404 });
  if (log.submitted_at) return NextResponse.json({ error: "Daily log already submitted" }, { status: 409 });

  // Delete existing reading for this daily log + equipment + field (MVP behavior)
  const { error: delErr } = await sb
    .from("meter_readings")
    .delete()
    .eq("context_id", dailyLogId)
    .eq("source", "DAILY_LOG")
    .eq("equipment_id", equipmentId)
    .eq("field_id", fieldId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { data: inserted, error: insErr } = await sb
    .from("meter_readings")
    .insert({
      equipment_id: equipmentId,
      field_id: fieldId,
      value: finalValue,
      unit: finalUnit,
      recorded_at: new Date().toISOString(),
      source: "DAILY_LOG",
      context_id: dailyLogId,
    })
    .select("id")
    .maybeSingle();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}