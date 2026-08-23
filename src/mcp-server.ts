import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AppConfig } from "./config.js";
import { SeatsAeroClient } from "./seats-aero-client.js";

const cabins = ["economy", "premium", "business", "first"] as const;
const regions = ["North America", "South America", "Africa", "Asia", "Europe", "Oceania"] as const;

const iataCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "must be a three-letter IATA airport code")
  .transform((value) => value.toUpperCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD format");
const nonNegativeInteger = z.number().int().min(0);
const positiveInteger = z.number().int().positive();

const cachedSearchSchema = z.object({
  originAirports: z.array(iataCode).min(1),
  destinationAirports: z.array(iataCode).min(1),
  startDate: date.optional(),
  endDate: date.optional(),
  cursor: nonNegativeInteger.optional(),
  take: z.number().int().min(10).max(1000).optional(),
  orderBy: z.enum(["lowest_mileage"]).optional(),
  skip: nonNegativeInteger.optional(),
  includeTrips: z.boolean().optional(),
  onlyDirectFlights: z.boolean().optional(),
  carriers: z.array(z.string().regex(/^[A-Za-z0-9]{2,3}$/)).min(1).optional(),
  includeFiltered: z.boolean().optional(),
  sources: z.array(z.string().min(1)).min(1).optional(),
  minifyTrips: z.boolean().optional(),
  cabins: z.array(z.enum(cabins)).min(1).optional()
});

const bulkAvailabilitySchema = z.object({
  source: z.string().min(1),
  cabin: z.enum(cabins).optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  originRegion: z.enum(regions).optional(),
  destinationRegion: z.enum(regions).optional(),
  take: z.number().int().min(10).max(1000).optional(),
  cursor: nonNegativeInteger.optional(),
  skip: nonNegativeInteger.optional(),
  includeFiltered: z.boolean().optional()
});

const getTripsSchema = z.object({
  id: z.string().min(1),
  includeFiltered: z.boolean().optional()
});

const sourceSchema = z.object({ source: z.string().min(1) });

const destinationsSchema = z
  .object({
    originAirport: iataCode.optional(),
    destinationAirport: iataCode.optional()
  })
  .refine(
    ({ originAirport, destinationAirport }) => Boolean(originAirport) !== Boolean(destinationAirport),
    "provide exactly one of originAirport or destinationAirport"
  );

const refreshCachedDataSchema = z.object({
  availabilityIds: z.array(z.string().min(1)).min(1).max(250)
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
  const server = new McpServer({ name: "seats-aero", version: "0.1.0" });

  server.registerTool(
    "seats_aero_cached_search",
    {
      title: "Cached Search",
      description:
        "Search cached award availability between one or more origin and destination airports. Results are summary availability objects; use seats_aero_get_trips for flight-level details.",
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
          include_trips: input.includeTrips,
          only_direct_flights: input.onlyDirectFlights,
          carriers: input.carriers?.join(","),
          include_filtered: input.includeFiltered,
          sources: input.sources?.join(","),
          minify_trips: input.minifyTrips,
          cabins: input.cabins?.join(",")
        })
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
        })
      )
  );

  server.registerTool(
    "seats_aero_get_trips",
    {
      title: "Get Trips",
      description: "Retrieve flight-level trips for a cached availability object ID.",
      inputSchema: getTripsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) =>
      callTool(() =>
        client.get(`/trips/${encodeURIComponent(input.id)}`, {
          include_filtered: input.includeFiltered
        })
      )
  );

  server.registerTool(
    "seats_aero_get_routes",
    {
      title: "Get Routes",
      description: "List cached routes for a mileage program.",
      inputSchema: sourceSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) => callTool(() => client.get("/routes", { source: input.source }))
  );

  server.registerTool(
    "seats_aero_get_destinations",
    {
      title: "Get Destinations",
      description:
        "Return airports reachable from, or airports that can reach, one airport, with the cheapest raw nonstop mileage price per cabin. Provide exactly one airport direction.",
      inputSchema: destinationsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (input) =>
      callTool(() =>
        client.get("/destinations", {
          origin_airport: input.originAirport,
          destination_airport: input.destinationAirport
        })
      )
  );

  server.registerTool(
    "seats_aero_refresh_cached_data",
    {
      title: "Refresh Cached Data",
      description:
        "Queue refreshes for stale cached availability objects and return their asynchronous status. Pro API keys only; repeat the same call to poll until complete is true. Do not use IDs from Live Search.",
      inputSchema: refreshCachedDataSchema,
      annotations: { readOnlyHint: false, idempotentHint: true }
    },
    async (input) => {
      if (config.plan !== "pro") {
        return unsupported("Refresh Cached Data is available only with a Seats.aero Pro API key.");
      }
      return callTool(() => client.post("/refresh", { availability_ids: input.availabilityIds }));
    }
  );

  server.registerTool(
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
      content: [{ type: "text" as const, text: JSON.stringify(await operation(), null, 2) }]
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
