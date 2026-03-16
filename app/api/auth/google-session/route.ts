import { NextResponse } from "next/server";
import { setUserSessionCookieOnResponse } from "../../../../lib/authSession";
import { supabaseAuth } from "../../../../lib/supabaseAuth";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let body: { accessToken?: string; redirectTo?: string } | null = null;

    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => null);
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData().catch(() => null);
      body = form
        ? {
            accessToken:
              typeof form.get("accessToken") === "string"
                ? String(form.get("accessToken"))
                : undefined,
            redirectTo:
              typeof form.get("redirectTo") === "string"
                ? String(form.get("redirectTo"))
                : undefined,
          }
        : null;
    }

    const accessToken =
      typeof body?.accessToken === "string" ? body.accessToken : "";
    const redirectTo =
      typeof body?.redirectTo === "string" && body.redirectTo.startsWith("/")
        ? body.redirectTo
        : "/?authSuccess=google";

    if (!accessToken) {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        return NextResponse.redirect(
          new URL("/?authError=missing_access_token", request.url)
        );
      }

      return NextResponse.json(
        { success: false, error: "Missing access token." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAuth.auth.getUser(accessToken);

    if (error || !data?.user?.id || !data.user.email) {
      console.error("google session route verification error:", error);

      if (contentType.includes("application/x-www-form-urlencoded")) {
        return NextResponse.redirect(
          new URL("/?authError=google_session_failed", request.url)
        );
      }

      return NextResponse.json(
        { success: false, error: "Google session verification failed." },
        { status: 401 }
      );
    }

    const response = contentType.includes("application/x-www-form-urlencoded")
      ? NextResponse.redirect(new URL(redirectTo, request.url))
      : NextResponse.json({
          success: true,
          user: {
            id: data.user.id,
            email: data.user.email,
          },
        });

    setUserSessionCookieOnResponse(response, data.user.id, data.user.email);
    return response;
  } catch (error) {
    console.error("google session route fatal error:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
