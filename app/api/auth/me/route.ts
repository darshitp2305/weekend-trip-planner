import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/authSession";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);

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
