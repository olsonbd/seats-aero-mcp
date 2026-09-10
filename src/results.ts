import type { ApiResult } from "./seats-aero-client.js";

const summaryFields = /^(ID|RouteID|Route|Date|Source|UpdatedAt|CreatedAt|[YWJF](Available|MileageCost|RemainingSeats|Airlines|Direct|DirectMileageCost|DirectRemainingSeats|Taxes|DirectTaxes|TaxesCurrency|DirectAirlines|DirectLastSeen)|TaxesCurrency)$/;
export function summarizeAvailability(result: ApiResult): ApiResult {
  const body = result.data;
  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).data)) return result;
  const envelope = body as Record<string, unknown> & { data: unknown[] };
  return {
    ...result,
    data: {
      ...envelope,
      data: envelope.data.map((row) => row && typeof row === "object"
        ? Object.fromEntries(Object.entries(row).filter(([key]) => summaryFields.test(key))) : row)
    }
  };
}

// Non-paginated upstream endpoints use explicit local pages. Each page is a new API call;
// offset applies to this response, not a durable snapshot of changing inventory.
export function pageResult(result: ApiResult, offset = 0, limit = 25): ApiResult {
  const body = result.data;
  const rows = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data)
    ? (body as { data: unknown[] }).data : undefined;
  if (!rows) return result;
  const envelope = Array.isArray(body) ? {} : body as Record<string, unknown>;
  return { ...result, data: {
    ...envelope, data: rows.slice(offset, offset + limit),
    page: { offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null }
  } };
}
