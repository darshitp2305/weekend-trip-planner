import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const plan = body?.plan;

    if (!plan?.id) {
      return NextResponse.json(
        { success: false, error: "Missing trip id." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("shared_trips")
      .upsert(
        {
          id: plan.id,
          trip_data: plan,
        },
        {
          onConflict: "id",
        }
      );

    if (error) {
      console.error("Supabase save-trip error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to save trip." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: plan.id,
      shareUrl: `/trip/${plan.id}`,
    });
  } catch (error) {
    console.error("save-trip route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}