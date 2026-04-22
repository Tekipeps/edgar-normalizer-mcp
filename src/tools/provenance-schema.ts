import { z } from "zod";

const provenanceSourceSchema = z.object({
  period_label: z.string(),
  filing_type: z.string(),
  accession_number: z.string(),
  filed_date: z.string(),
  source_url: z.string(),
});

export const factProvenanceSchema = z.union([
  z.object({
    type: z.literal("reported"),
    filing_type: z.string(),
    accession_number: z.string(),
    filed_date: z.string(),
    source_url: z.string(),
  }),
  z.object({
    type: z.literal("derived"),
    method: z.literal("annual_minus_nine_months"),
    annual_source: provenanceSourceSchema,
    subtracted_source: provenanceSourceSchema,
  }),
]);
