import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string | null | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
