import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

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

export async function createUserSessionCookie(userId: string, email: string) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload: SessionPayload = {
    userId,
    email,
    issuedAt,
    expiresAt,
  };

  const encoded = encodePayload(payload);
  const signature = sign(encoded);

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, `${encoded}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });

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
