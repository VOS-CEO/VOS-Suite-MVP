import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: dailyLogId } = await ctx.params;

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("daily_log_tab_state")
    .select("tab_code, viewed_at, ok_at")
    .eq("daily_log_id", dailyLogId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ items: data ?? [] });
}