import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/authSession";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const plan = body?.plan;
    const authUser = await getAuthenticatedUser();

    if (!plan?.id) {
      return NextResponse.json(
        { success: false, error: "Missing trip id." },
        { status: 400 }
      );
    }

    const sharedTripRecord = {
      id: plan.id,
      trip_data: plan,
    };

    const records = [sharedTripRecord];

    if (authUser?.userId) {
      records.push({
        id: `user:${authUser.userId}:${plan.id}`,
        trip_data: {
          ...plan,
          ownerUserId: authUser.userId,
        },
      });
    }

    const { error } = await supabaseAdmin
      .from("shared_trips")
      .upsert(records, {
        onConflict: "id",
      });

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
      accountSaved: Boolean(authUser?.userId),
    });
  } catch (error) {
    console.error("save-trip route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
