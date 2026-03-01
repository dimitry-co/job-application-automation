import { NextResponse } from "next/server";
import { JobStatus as PrismaJobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

const PENDING_STATUSES: PrismaJobStatus[] = [
  PrismaJobStatus.new,
  PrismaJobStatus.reviewing,
  PrismaJobStatus.ready,
  PrismaJobStatus.form_filling,
  PrismaJobStatus.form_ready
];

export async function GET() {
  const [total, pending, submitted, accepted, rejected] = await prisma.$transaction([
    prisma.job.count(),
    prisma.job.count({
      where: {
        status: {
          in: PENDING_STATUSES
        }
      }
    }),
    prisma.job.count({
      where: {
        status: PrismaJobStatus.submitted
      }
    }),
    prisma.job.count({
      where: {
        status: PrismaJobStatus.accepted
      }
    }),
    prisma.job.count({
      where: {
        status: PrismaJobStatus.rejected
      }
    })
  ]);

  return NextResponse.json({
    total,
    pending,
    submitted,
    accepted,
    rejected
  });
}
