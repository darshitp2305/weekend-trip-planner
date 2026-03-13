import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    tripId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { tripId } = await context.params;

    if (!tripId) {
      return NextResponse.json(
        { success: false, error: "Missing trip id." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("shared_trips")
      .select("trip_data")
      .eq("id", tripId)
      .maybeSingle();

    if (error) {
      console.error("Supabase get-trip error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load trip." },
        { status: 500 }
      );
    }

    if (!data?.trip_data) {
      return NextResponse.json(
        { success: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      trip: data.trip_data,
    });
  } catch (error) {
    console.error("get-trip route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}