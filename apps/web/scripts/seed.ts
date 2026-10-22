import { eq } from "drizzle-orm";
import { connect } from "../src/db";
import * as schema from "../src/db/schema";
import { createOrg } from "../src/lib/org-setup";

/** Creates Exaltes Global as the first company, if it doesn't exist yet. */
const url = process.env.DATABASE_URL;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!url || !email || !password) {
  throw new Error("Set DATABASE_URL, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD");
}

const { db, pool } = connect(url, 1);
try {
  const gstin = "27AAJCE3276G1ZH";
  const [existing] = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.gstin, gstin));
  if (existing) {
    console.log(`Exaltes Global already exists (${existing.id})`);
  } else {
    const { orgId } = await createOrg(
      db,
      { name: "Exaltes Global", legalName: "Exaltes Global Private Limited", gstin, tan: "PNEE11205F" },
      { email, name: "Anup Lohade", password },
    );
    console.log(`Created Exaltes Global (${orgId}) with admin ${email}`);
  }
} finally {
  await pool.end();
}
