import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { today } from "../../reports/period";
import { gstr1Csv, gstr1Json, loadReturns, portalPeriod, readMonth, toCsv } from "../data";

/** Downloads: ?month=2026-10&format=json, or &format=csv&section=b2b|b2cl|b2cs|cdnr|hsn|docs */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in first", { status: 401 });
  const org = await getOrg(session.orgId);
  const params = req.nextUrl.searchParams;
  const month = readMonth(params.get("month") ?? undefined, today());
  const { gstr1 } = await loadReturns(session.orgId, month);
  const period = portalPeriod(month);
  if (params.get("format") === "json") {
    if (!org.gstin) return new NextResponse("Add your GSTIN first", { status: 400 });
    return new NextResponse(JSON.stringify(gstr1Json(org.gstin, period, gstr1), null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="GSTR1_${org.gstin}_${period}.json"`,
      },
    });
  }
  const table = gstr1Csv(gstr1, params.get("section") ?? "");
  if (!table) return new NextResponse("Unknown section", { status: 400 });
  return new NextResponse("﻿" + toCsv(table.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="GSTR1_${table.name}_${period}.csv"`,
    },
  });
}
