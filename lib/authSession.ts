import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAuth } from "./supabaseAuth";

export const AUTH_COOKIE_NAME = "trippify_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type SessionPayload = {
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
};

function getSessionSecret(): string {
  const secret =
    process.env.AUTH_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error("Missing AUTH_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): SessionPayload | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

function buildSessionCookieValue(payload: SessionPayload) {
  const encoded = encodePayload(payload);
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function sessionCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  };
}

function createSessionPayload(userId: string, email: string): SessionPayload {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;

  return {
    userId,
    email,
    issuedAt,
    expiresAt,
  };
}

export async function createUserSessionCookie(userId: string, email: string) {
  const payload = createSessionPayload(userId, email);

  const cookieStore = await cookies();
  cookieStore.set(
    AUTH_COOKIE_NAME,
    buildSessionCookieValue(payload),
    sessionCookieOptions(payload.expiresAt)
  );

  return payload;
}

export function setUserSessionCookieOnResponse(
  response: NextResponse,
  userId: string,
  email: string
) {
  const payload = createSessionPayload(userId, email);

  response.cookies.set(
    AUTH_COOKIE_NAME,
    buildSessionCookieValue(payload),
    sessionCookieOptions(payload.expiresAt)
  );

  return payload;
}

export async function clearUserSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!raw) return null;

  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = sign(encoded);
  const received = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return null;
  }

  const payload = decodePayload(encoded);
  if (!payload) return null;
  if (!payload.userId || !payload.email) return null;
  if (payload.expiresAt <= Date.now()) return null;

  return payload;
}

export async function getAuthenticatedUserFromRequest(request: Request) {
  const cookieUser = await getAuthenticatedUser();
  if (cookieUser) {
    return cookieUser;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return null;
  }

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error || !data?.user?.id || !data.user.email) {
      return null;
    }

    return {
      userId: data.user.id,
      email: data.user.email,
      issuedAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  } catch {
    return null;
  }
}
