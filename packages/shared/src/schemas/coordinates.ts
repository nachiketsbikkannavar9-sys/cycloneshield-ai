import { z } from "zod";

export const coordinatesSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export const boundingBoxSchema = z.object({
  minLatitude: z.coerce.number().min(-90).max(90),
  minLongitude: z.coerce.number().min(-180).max(180),
  maxLatitude: z.coerce.number().min(-90).max(90),
  maxLongitude: z.coerce.number().min(-180).max(180),
});

export type Coordinates = z.infer<typeof coordinatesSchema>;
export type BoundingBox = z.infer<typeof boundingBoxSchema>;
