import { Router } from "express";
import { getOpenMeteoDescriptor } from "../providers/open-meteo.js";

export const dataSourcesRouter = Router();

dataSourcesRouter.get("/", (_request, response) => {
  response.json({
    sources: [getOpenMeteoDescriptor()],
  });
});
