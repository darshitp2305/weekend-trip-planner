import { NextResponse } from "next/server";
import { createUserSessionCookie } from "../../../../lib/authSession";
import { supabaseAuth } from "../../../../lib/supabaseAuth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password =
      typeof body?.password === "string" ? body.password : "";

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Email and password (8+ chars) are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    const user = data.user;
    const sessionUser = data.session?.user;

    if (!sessionUser?.id || !sessionUser.email) {
      return NextResponse.json({
        success: true,
        user: user?.id && user.email ? { id: user.id, email: user.email } : null,
        needsEmailConfirmation: true,
        message: "Check your email to confirm the account, then log in.",
      });
    }

    await createUserSessionCookie(sessionUser.id, sessionUser.email);

    return NextResponse.json({
      success: true,
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
      },
      needsEmailConfirmation: false,
    });
  } catch (error) {
    console.error("signup route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
