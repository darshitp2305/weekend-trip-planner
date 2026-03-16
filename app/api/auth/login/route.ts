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

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user?.id || !data.user.email) {
      return NextResponse.json(
        { success: false, error: error?.message ?? "Login failed." },
        { status: 401 }
      );
    }

    await createUserSessionCookie(data.user.id, data.user.email);

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (error) {
    console.error("login route error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
