import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type PowerSource = "SHORE" | "GENERATOR";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parsePowerSource(v: unknown): PowerSource {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return s === "GENERATOR" ? "GENERATOR" : "SHORE";
}

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Parse body safely
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson(
      "Invalid JSON body. Expected { status, location_text, notes, power_source }",
      400
    );
  }

  if (!isObject(body)) {
    return errorJson("Bad request body. Expected a JSON object.", 400);
  }

  // Validate status
  const statusRaw = asStringOrNull(body.status);
  const status = String(statusRaw ?? "dock").toLowerCase().trim();
  const allowed = new Set(["dock", "underway", "anchor", "shipyard"]);
  if (!allowed.has(status)) {
    return errorJson("Invalid status. Use dock, underway, anchor, or shipyard.", 400);
  }

  // Extract fields
  const location_text = asStringOrNull(body.location_text);
  const notes = asStringOrNull(body.notes);
  const power_source: PowerSource = parsePowerSource(body.power_source);

  const sb = await supabaseServer();

  // Lock check
  const { data: current, error: curErr } = await sb
    .from("daily_logs")
    .select("id, submitted_at")
    .eq("id", id)
    .single();

  if (curErr) {
    return NextResponse.json({ error: curErr.message }, { status: 500 });
  }

  if (current?.submitted_at) {
    return errorJson("Daily Log is already submitted; header is locked.", 409);
  }

  // Update
  const { data: updated, error: updErr } = await sb
    .from("daily_logs")
    .update({
      status,
      location_text: location_text ?? null,
      notes: notes ?? null,
      power_source,
    })
    .eq("id", id)
    .select("id, vessel_id, log_date, status, location_text, notes, submitted_at, power_source")
    .single();

  if (updErr) {
    return NextResponse.json({ error: updErr.message, details: updErr }, { status: 500 });
  }

  return NextResponse.json({ log: updated });
}