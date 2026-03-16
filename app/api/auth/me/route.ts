import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/authSession";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();

    return NextResponse.json({
      success: true,
      user: user
        ? {
            id: user.userId,
            email: user.email,
          }
        : null,
    });
  } catch (error) {
    console.error("auth me route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
