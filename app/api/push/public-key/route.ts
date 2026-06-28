import { NextResponse } from "next/server";
import { getVapidPublicKey } from "../../../../lib/push";

export async function GET() {
  const response = NextResponse.json({ publicKey: getVapidPublicKey() });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
