import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  status?: string;
  location_text?: string | null;
  weather_text?: string | null;
  notes?: string | null;
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: dailyLogId } = await ctx.params;
  const body = (await req.json()) as Body;

  const update: Record<string, unknown> = {};
  if (typeof body.status === "string") update.status = body.status;
  if ("location_text" in body) update.location_text = body.location_text ?? null;
  if ("weather_text" in body) update.weather_text = body.weather_text ?? null;
  if ("notes" in body) update.notes = body.notes ?? null;

  const sb = supabaseServer();

  const { data: existing, error: exErr } = await sb
    .from("daily_logs")
    .select("submitted_at")
    .eq("id", dailyLogId)
    .maybeSingle();

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Daily log not found" }, { status: 404 });
  if (existing.submitted_at)
    return NextResponse.json({ error: "Daily log already submitted; header is locked." }, { status: 400 });

  const { data, error } = await sb
    .from("daily_logs")
    .update(update)
    .eq("id", dailyLogId)
    .select("id,status,location_text,weather_text,notes,submitted_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ log: data });
}