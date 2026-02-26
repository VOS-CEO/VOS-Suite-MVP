import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// ✅ Next.js 16 / Turbopack in your project treats params as async in some routes.
// Use ctx.params as a Promise and await it (same as your working E&M route).
type Ctx = { params: Promise<{ id: string }> };

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
  const hours = body?.hours as number | undefined;

  if (!equipmentId) return NextResponse.json({ error: "equipmentId required" }, { status: 400 });
  if (!fieldId) return NextResponse.json({ error: "fieldId required" }, { status: 400 });
  if (typeof hours !== "number" || Number.isNaN(hours)) {
    return NextResponse.json({ error: "hours must be a number" }, { status: 400 });
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

  // MVP: delete existing reading for this daily log + equipment + field
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
      value: { num: hours },
      unit: "hours",
      recorded_at: new Date().toISOString(),
      source: "DAILY_LOG",
      context_id: dailyLogId,
    })
    .select("id")
    .maybeSingle();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}