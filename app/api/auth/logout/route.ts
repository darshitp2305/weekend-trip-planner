import { NextResponse } from "next/server";
import { clearUserSessionCookie } from "../../../../lib/authSession";

export async function POST() {
  try {
    await clearUserSessionCookie();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("logout route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
