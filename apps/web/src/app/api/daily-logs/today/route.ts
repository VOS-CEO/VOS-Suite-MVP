import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET() {
  const sb = supabaseServer();

  // Use latest-created vessel as "current" for MVP
  const { data: vessel, error: vErr } = await sb
    .from("vessels")
    .select("id,name,created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!vessel) return NextResponse.json({ error: "No vessel found" }, { status: 404 });

  const log_date = todayISO();

  // Create if missing (idempotent)
  // Ensure status is set to a known default on insert.
  const { error: upErr } = await sb
    .from("daily_logs")
    .upsert(
      {
        vessel_id: vessel.id,
        log_date,
        status: "dock",
      },
      { onConflict: "vessel_id,log_date" }
    );

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Load today’s log with a stable field list (Step 3 needs these)
  const { data: log, error: lErr } = await sb
    .from("daily_logs")
    .select("id,vessel_id,log_date,status,location_text,weather_text,notes,submitted_at")
    .eq("vessel_id", vessel.id)
    .eq("log_date", log_date)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!log) return NextResponse.json({ error: "Failed to load daily log" }, { status: 500 });

  return NextResponse.json({ vessel, log });
}