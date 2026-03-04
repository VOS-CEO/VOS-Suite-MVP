import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  tab_code: string;
  action: "VIEW" | "OK";
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: dailyLogId } = await ctx.params;
  const body = (await req.json()) as Body;

  const tab = String(body.tab_code || "").toUpperCase();
  const action = body.action;

  const allowed = new Set(["MAIN", "AHUS", "BILGES", "TANKS", "ORB", "RUNNING_LOG"]);
  if (!allowed.has(tab)) return NextResponse.json({ error: "Invalid tab_code" }, { status: 400 });
  if (action !== "VIEW" && action !== "OK")
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const supabase = supabaseServer();
  const now = new Date().toISOString();

  const baseUpdate: Record<string, string> = {};
  if (action === "VIEW") baseUpdate.viewed_at = now;
  if (action === "OK") {
    baseUpdate.viewed_at = now;
    baseUpdate.ok_at = now;
  }

  const { error } = await supabase
    .from("daily_log_tab_state")
    .upsert(
      {
        daily_log_id: dailyLogId,
        tab_code: tab,
        ...baseUpdate,
      },
      { onConflict: "daily_log_id,tab_code" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}