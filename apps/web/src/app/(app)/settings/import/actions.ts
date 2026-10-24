"use server";

import { revalidatePath } from "next/cache";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { importOdoo, odooExport, type ImportReport } from "@/lib/odoo-import";

export interface ImportState {
  error?: string;
  mode?: "preview" | "import";
  report?: ImportReport;
}

const MAX_BYTES = 15 * 1024 * 1024;

class Preview extends Error {
  constructor(readonly report: ImportReport) {
    super("preview");
  }
}

/** Preview runs the whole import in a transaction and rolls it back, so what it shows is exactly what Import will do. */
export async function runOdooImport(_prev: ImportState, data: FormData): Promise<ImportState> {
  const session = await requireSession();
  if (session.role !== "admin") return { error: "Only an admin can import data." };
  const mode = data.get("mode") === "import" ? "import" : "preview";
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the odoo-export.json file made by the export script." };
  if (file.size > MAX_BYTES) return { error: "That file is over 15 MB. Contact support to import a company this size." };
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { error: "That file isn't valid JSON. Upload the odoo-export.json the script wrote." };
  }
  const parsed = odooExport.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `That isn't an export this version of Tevah can read (${issue?.path.join(".") || "file"}: ${issue?.message}).` };
  }
  try {
    const report = await withOrg(session.orgId, async (s) => {
      const r = await importOdoo(s, session, parsed.data);
      if (mode === "preview") throw new Preview(r);
      return r;
    });
    revalidatePath("/", "layout");
    return { mode, report };
  } catch (e) {
    if (e instanceof Preview) return { mode, report: e.report };
    throw e;
  }
}
