import { HiAnimeError } from "aniwatch";
import type { ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { log } from "./logger.js";

export const errorHandler: ErrorHandler = (err, c) => {
    log.error(JSON.stringify(err));
    const status = err instanceof HiAnimeError ? err.status as ContentfulStatusCode : 500;
    const message = err instanceof HiAnimeError ? err.message : "Internal Server Error";
    return c.json({ status, message }, status);
};

export const notFoundHandler: NotFoundHandler = (c) => {
    return c.json({ status: 404, message: "Not Found" }, 404);
};
