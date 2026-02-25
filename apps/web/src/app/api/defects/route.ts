import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function makeDefectNo() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `DF-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
}

export async function POST(req: Request) {
  const sb = supabaseServer();
  const body = await req.json().catch(() => ({}));

  const dailyLogId = body?.dailyLogId as string | undefined;
  const title = (body?.title as string | undefined)?.trim();
  const equipmentId = (body?.equipmentId as string | undefined) ?? null;

  if (!dailyLogId) return NextResponse.json({ error: "dailyLogId required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  // Get vessel_id from daily log (ensures correct vessel_id)
  const { data: log, error: lErr } = await sb
    .from("daily_logs")
    .select("id,vessel_id,location_text")
    .eq("id", dailyLogId)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!log) return NextResponse.json({ error: "Daily log not found" }, { status: 404 });

  const defect_no = makeDefectNo();

  const { data: defect, error: dErr } = await sb
    .from("defects")
    .insert({
      defect_no,
      vessel_id: log.vessel_id,
      equipment_id: equipmentId,
      title,
      location_text: body?.location_text ?? log.location_text ?? null,
      priority: body?.priority ?? "med",
      department: body?.department ?? null,
      nature: body?.nature ?? null,
      reported_by: body?.reportedBy ?? null,
    })
    .select("*")
    .maybeSingle();

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (!defect) return NextResponse.json({ error: "Failed to create defect" }, { status: 500 });

  // Best-effort audit link-back (ignore if activities_log schema differs)
  await sb.from("activities_log").insert({
    vessel_id: log.vessel_id,
    actor_id: null,
    action: "DEFECT_CREATED_FROM_DAILY_LOG",
    entity_type: "defect",
    entity_id: defect.id,
    metadata: { daily_log_id: dailyLogId },
  });

  return NextResponse.json({ defect });
}