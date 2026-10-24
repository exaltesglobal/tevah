import { minutesToHours, monthRange } from "@tevah/core";
import { NextResponse, type NextRequest } from "next/server";
import { withOrg } from "@/db";
import { getSession } from "@/lib/auth";
import { timeEntriesFor } from "@/lib/projects";
import { toCsv } from "../../gst/data";
import { readDate, today } from "../../reports/period";

/** Free text typed by people; a leading = + - @ would run as a formula in Excel. */
const text = (v: string | null) => (v && /^[=+\-@]/.test(v) ? `'${v}` : (v ?? ""));

/** Time entries as CSV: ?from=2026-10-01&to=2026-10-31[&user=<id>] */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in first", { status: 401 });
  const params = req.nextUrl.searchParams;
  const month = monthRange(today());
  const from = params.get("from") ? readDate(params.get("from")!) : month.from;
  const to = params.get("to") ? readDate(params.get("to")!) : month.to;
  const user = params.get("user") || undefined;
  const rows = await withOrg(session.orgId, (s) => timeEntriesFor(s, { from, to, userId: user }));
  const csv = toCsv([
    ["Date", "Person", "Project", "Task", "Note", "Hours", "Billable"],
    ...rows.reverse().map((r) => [r.date, text(r.user), text(r.project), text(r.task), text(r.note), minutesToHours(r.minutes), r.billable ? "Yes" : "No"]),
  ]);
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="timesheet_${from}_${to}.csv"`,
    },
  });
}
