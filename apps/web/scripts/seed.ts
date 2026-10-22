import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { createOrg } from "../src/lib/org-setup";

/** Creates Exaltes Global as the first company, if it doesn't exist yet. */
const adminUrl = process.env.DATABASE_ADMIN_URL;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!adminUrl || !email || !password) {
  throw new Error("Set DATABASE_ADMIN_URL, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD");
}

const client = postgres(adminUrl, { max: 1 });
const db = drizzle({ client, schema });
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
  await client.end();
}
