import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const sb = supabaseServer();

  const { data, error } = await sb
    .from("vessels")
    .select("id,name,timezone,created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No vessels found" }, { status: 404 });

  return NextResponse.json(data);
}