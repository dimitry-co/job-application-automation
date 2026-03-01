import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    total: 0,
    pending: 0,
    submitted: 0,
    accepted: 0,
    rejected: 0
  });
}
