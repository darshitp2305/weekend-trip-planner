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

    const prefix = `analytics:${authUser.userId}:`;

    const { data, error } = await supabaseAdmin
      .from("shared_trips")
      .select("trip_data")
      .like("id", `${prefix}%`)
      .order("id", { ascending: false });

    if (error) {
      console.error("account analytics route error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load account analytics." },
        { status: 500 }
      );
    }

    const events = (data ?? [])
      .map((row) => row.trip_data)
      .sort((a, b) => `${b?.at ?? ""}`.localeCompare(`${a?.at ?? ""}`));

    return NextResponse.json({
      success: true,
      events,
    });
  } catch (error) {
    console.error("account analytics route fatal error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
