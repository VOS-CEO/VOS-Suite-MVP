import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const sb = await supabaseServer();

  // 1) Pick a "current" vessel: latest created
  const { data: vessel, error: vErr } = await sb
    .from("vessels")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (vErr || !vessel?.id) {
    return NextResponse.json({ error: vErr?.message ?? "No vessel found" }, { status: 500 });
  }

  const vessel_id = vessel.id as string;

  // 2) Upsert today's daily log row
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const log_date = `${yyyy}-${mm}-${dd}`;

  // IMPORTANT:
  // Do NOT include power_source here, or you might overwrite an existing saved value on conflict.
  // Let DB default handle inserts; leave existing rows untouched.
  const { data: upserted, error: uErr } = await sb
    .from("daily_logs")
    .upsert(
      {
        vessel_id,
        log_date,
        status: "dock",
      },
      { onConflict: "vessel_id,log_date" }
    )
    .select("id, vessel_id, log_date, status, location_text, notes, submitted_at, power_source")
    .single();

  if (uErr || !upserted) {
    return NextResponse.json({ error: uErr?.message ?? "Failed to upsert daily log" }, { status: 500 });
  }

  return NextResponse.json({ log: upserted });
}