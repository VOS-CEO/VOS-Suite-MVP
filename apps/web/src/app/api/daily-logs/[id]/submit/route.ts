import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function requiresRunningLog(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase();
  return s === "underway" || s === "anchor";
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: dailyLogId } = await ctx.params;

  const supabase = supabaseServer();

  const { data: log, error: logErr } = await supabase
    .from("daily_logs")
    .select("id, status, submitted_at")
    .eq("id", dailyLogId)
    .maybeSingle();

  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 400 });
  if (!log) return NextResponse.json({ error: "Daily log not found" }, { status: 404 });
  if (log.submitted_at) return NextResponse.json({ error: "Already submitted" }, { status: 400 });

  const { data: tabs, error: tabErr } = await supabase
    .from("daily_log_tab_state")
    .select("tab_code, ok_at")
    .eq("daily_log_id", dailyLogId);

  if (tabErr) return NextResponse.json({ error: tabErr.message }, { status: 400 });

  const okSet = new Set((tabs ?? []).filter((t) => t.ok_at).map((t) => String(t.tab_code).toUpperCase()));

  const required = ["AHUS", "BILGES", "TANKS"];
  const missing: string[] = required.filter((t) => !okSet.has(t));

  if (requiresRunningLog(log.status)) {
    if (!okSet.has("RUNNING_LOG")) missing.push("RUNNING_LOG");
  }

  if (missing.length) {
    return NextResponse.json({ error: `Cannot submit. Missing OK: ${missing.join(", ")}` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase.from("daily_logs").update({ submitted_at: now }).eq("id", dailyLogId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, submitted_at: now });
}