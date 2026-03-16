import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/authSession";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET(request: Request) {
  try {
    const authUser = await getAuthenticatedUserFromRequest(request);

    if (!authUser?.userId) {
      return NextResponse.json(
        { success: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    const prefix = `user:${authUser.userId}:`;

    const { data, error } = await supabaseAdmin
      .from("shared_trips")
      .select("trip_data")
      .like("id", `${prefix}%`)
      .order("id", { ascending: false });

    if (error) {
      console.error("account trips route error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load account trips." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      trips: (data ?? []).map((row) => row.trip_data),
    });
  } catch (error) {
    console.error("account trips route fatal error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const authUser = await getAuthenticatedUserFromRequest(request);

    if (!authUser?.userId) {
      return NextResponse.json(
        { success: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const tripId =
      typeof body?.tripId === "string" ? body.tripId.trim() : "";

    if (!tripId) {
      return NextResponse.json(
        { success: false, error: "Missing trip id." },
        { status: 400 }
      );
    }

    const accountTripId = `user:${authUser.userId}:${tripId}`;

    const { error } = await supabaseAdmin
      .from("shared_trips")
      .delete()
      .eq("id", accountTripId);

    if (error) {
      console.error("account trips delete route error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to remove account trip." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tripId,
    });
  } catch (error) {
    console.error("account trips delete route fatal error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
