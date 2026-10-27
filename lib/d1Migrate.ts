// Adds columns to tables that already exist in D1 (we cannot run SQL by hand). Idempotent: a column that is already there is fine.
// Routes call it when a statement fails with "no such column", then retry once. d1/0009_feedback_person_water.sql holds the same statements.
import { d1Query } from "@/lib/d1";

export const isMissingColumn = (e: unknown): boolean => /no such column|has no column named/i.test(String(e instanceof Error ? e.message : e));

export async function addColumns(statements: string[]): Promise<void> {
  for (const s of statements) {
    try {
      await d1Query(s);
    } catch (e) {
      if (!/duplicate column/i.test(String(e instanceof Error ? e.message : e))) throw e;
    }
  }
}
