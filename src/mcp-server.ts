import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AppConfig } from "./config.js";
import { summarizeAvailability, pageResult } from "./results.js";
import { SeatsAeroClient } from "./seats-aero-client.js";
import { PACKAGE_VERSION } from "./version.js";

const cabins = ["economy", "premium", "business", "first"] as const;
const regions = ["North America", "South America", "Africa", "Asia", "Europe", "Oceania"] as const;

const iataCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "must be a three-letter IATA airport code")
  .transform((value) => value.toUpperCase());
const date = z.iso.date();
const nonNegativeInteger = z.number().int().min(0);
const positiveInteger = z.number().int().positive();

const dateRange = (input: { startDate?: string; endDate?: string }) => !input.startDate || !input.endDate || input.startDate <= input.endDate;
const cachedSearchSchema = z.object({
  originAirports: z.array(iataCode).min(1).max(10),
  destinationAirports: z.array(iataCode).min(1).max(10),
  startDate: date.optional(),
  endDate: date.optional(),
  cursor: nonNegativeInteger.optional(),
  take: z.number().int().min(10).max(100).default(25),
  orderBy: z.enum(["lowest_mileage"]).optional(),
  skip: nonNegativeInteger.optional(),
  onlyDirectFlights: z.boolean().optional(),
  carriers: z.array(z.string().regex(/^[A-Za-z0-9]{2,3}$/)).min(1).optional(),
  includeFiltered: z.boolean().optional(),
  sources: z.array(z.string().min(1)).min(1).optional(),
  cabins: z.array(z.enum(cabins)).min(1).optional(),
  minCabinPct: z.number().int().min(0).max(100).default(100),
  format: z.enum(["summary", "full"]).default("summary")
}).refine(dateRange, "startDate must not follow endDate");

const bulkAvailabilitySchema = z.object({
  source: z.string().min(1),
  cabin: z.enum(cabins).optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  originRegion: z.enum(regions).optional(),
  destinationRegion: z.enum(regions).optional(),
  take: z.number().int().min(10).max(100).default(25),
  cursor: nonNegativeInteger.optional(),
  skip: nonNegativeInteger.optional(),
  includeFiltered: z.boolean().optional()
}).refine(dateRange, "startDate must not follow endDate");

const localPage = { offset: nonNegativeInteger.default(0), limit: z.number().int().min(1).max(50).default(25) };
const getTripsSchema = z.object({
  id: z.string().min(1).max(200),
  includeFiltered: z.boolean().optional(),
  minCabinPct: z.number().int().min(0).max(100).default(100),
  ...localPage
});

const sourceSchema = z.object({ source: z.string().min(1), ...localPage });

const destinationsSchema = z
  .object({
    originAirport: iataCode.optional(),
    destinationAirport: iataCode.optional(),
    ...localPage
  })
  .refine(
    ({ originAirport, destinationAirport }) => Boolean(originAirport) !== Boolean(destinationAirport),
    "provide exactly one of originAirport or destinationAirport"
  );

const refreshCachedDataSchema = z.object({
  availabilityIds: z.array(z.string().min(1).max(200)).min(1).max(10)
});

const liveSearchSchema = z.object({
  originAirport: iataCode,
  destinationAirport: iataCode,
  departureDate: date,
  source: z.string().min(1),
  disableFilters: z.boolean().optional(),
  showDynamicPricing: z.boolean().optional(),
  seatCount: z.number().int().min(1).max(9).optional()
});

export function createSeatsAeroMcpServer(config: AppConfig, client: SeatsAeroClient): McpServer {
  const server = new McpServer({ name: "seats-aero", version: PACKAGE_VERSION });

  server.registerTool(
    "seats_aero_cached_search",
    {
      title: "Cached Search",
      description:
        "Search cached award availability between one or more origin and destination airports. Cached data is not guaranteed bookable. Defaults to 25 summaries; preserve cursor/hasMore to request the next page explicitly. Missing seat counts are unknown. Use seats_aero_get_trips for itinerary details and taxes. format=full retains upstream fields.",
      inputSchema: cachedSearchSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) =>
      callTool(() =>
        client.get("/search", {
          origin_airport: input.originAirports.join(","),
          destination_airport: input.destinationAirports.join(","),
          start_date: input.startDate,
          end_date: input.endDate,
          cursor: input.cursor,
          take: input.take,
          order_by: input.orderBy,
          skip: input.skip,
          include_trips: false,
          only_direct_flights: input.onlyDirectFlights,
          carriers: input.carriers?.join(","),
          include_filtered: input.includeFiltered,
          sources: input.sources?.join(","),
          cabins: input.cabins?.join(","),
          min_cabin_pct: input.minCabinPct
        }).then(result => input.format === "summary" ? summarizeAvailability(result) : result)
      )
  );

  server.registerTool(
    "seats_aero_bulk_availability",
    {
      title: "Bulk Availability",
      description:
        "Retrieve a broad set of cached availability objects for one mileage program, optionally filtered by cabin, date, and region.",
      inputSchema: bulkAvailabilitySchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) =>
      callTool(() =>
        client.get("/availability", {
          source: input.source,
          cabin: input.cabin,
          start_date: input.startDate,
          end_date: input.endDate,
          origin_region: input.originRegion,
          destination_region: input.destinationRegion,
          take: input.take,
          cursor: input.cursor,
          skip: input.skip,
          include_filtered: input.includeFiltered
        }).then(summarizeAvailability)
      )
  );

  server.registerTool(
    "seats_aero_get_trips",
    {
      title: "Get Trips",
      description: "Retrieve flight-level trips for a cached availability ID. Times are local airport times; taxes retain upstream units/currency. Defaults to 25 itineraries; use page.nextOffset for another page (costs a new API call).",
      inputSchema: getTripsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) =>
      callTool(() =>
        client.get(`/trips/${encodeURIComponent(input.id)}`, {
          include_filtered: input.includeFiltered,
          min_cabin_pct: input.minCabinPct
        }).then(result => pageResult(result, input.offset, input.limit))
      )
  );

  server.registerTool(
    "seats_aero_get_routes",
    {
      title: "Get Routes",
      description: "List cached routes for a mileage program. Use page.nextOffset to retrieve additional routes; each page costs an API call.",
      inputSchema: sourceSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) => callTool(() => client.get("/routes", { source: input.source }).then(result => pageResult(result, input.offset, input.limit)))
  );

  server.registerTool(
    "seats_aero_get_destinations",
    {
      title: "Get Destinations",
      description:
        "Return airports reachable from, or airports that can reach, one airport, with the cheapest raw nonstop mileage price per cabin. Provide exactly one airport direction. Use page.nextOffset for additional results; each page costs an API call.",
      inputSchema: destinationsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) =>
      callTool(() =>
        client.get("/destinations", {
          origin_airport: input.originAirport,
          destination_airport: input.destinationAirport
        }).then(result => pageResult(result, input.offset, input.limit))
      )
  );

  server.registerTool(
    "seats_aero_list_active_alerts",
    {
      title: "List Active Alerts",
      description:
        "List the authenticated user's non-expired Seats.aero alerts, including paused alerts. Pro users only; commercial partner keys do not identify a user. Results are returned newest first by the upstream API.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async () => {
      if (config.plan !== "pro") {
        return unsupported("List Active Alerts is available only with a Seats.aero Pro API key.");
      }
      return callTool(() => client.get("/alerts", {}));
    }
  );

  server.registerTool(
    "seats_aero_refresh_cached_data",
    {
      title: "Refresh Cached Data",
      description:
        "Queue refreshes for stale cached availability objects and return their asynchronous status. Pro only. Maximum 10 IDs: each newly queued item can cost one daily quota credit. Repeating queued IDs only polls. Wait at least 10 seconds between polls, stop after 2 minutes, and wait 15 minutes after a failed refresh. Cached IDs only.",
      inputSchema: refreshCachedDataSchema,
      annotations: { readOnlyHint: false, idempotentHint: true }
    },
    async (input) => {
      if (config.plan !== "pro") {
        return unsupported("Refresh Cached Data is available only with a Seats.aero Pro API key.");
      }
      return callTool(() => client.post("/refresh", { availability_ids: [...new Set(input.availabilityIds)] }));
    }
  );

  if (config.plan === "commercial") server.registerTool(
    "seats_aero_live_search",
    {
      title: "Live Search",
      description:
        "Perform a live award search for one city pair and date. Commercial Seats.aero API keys only; live-search IDs cannot be used with other partner endpoints.",
      inputSchema: liveSearchSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) => {
      if (config.plan !== "commercial") {
        return unsupported("Live Search requires a commercial Seats.aero API agreement and key.");
      }
      return callTool(() =>
        client.post("/live", {
          origin_airport: input.originAirport,
          destination_airport: input.destinationAirport,
          departure_date: input.departureDate,
          source: input.source,
          disable_filters: input.disableFilters,
          show_dynamic_pricing: input.showDynamicPricing,
          seat_count: input.seatCount
        })
      );
    }
  );

  return server;
}

async function callTool(operation: () => Promise<unknown>) {
  try {
    return {
      content: [{ type: "text" as const, text: encodeResult(await operation()) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: errorMessage(error) }],
      isError: true
    };
  }
}

function unsupported(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Seats.aero request failed with an unknown error";
}

function encodeResult(result: unknown): string {
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error("Result exceeds 64 KiB. Reduce take/limit, narrow the search, or use summary format. No results were silently truncated.");
  return text;
}
