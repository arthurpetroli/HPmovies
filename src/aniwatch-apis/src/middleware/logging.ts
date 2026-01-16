import type { MiddlewareHandler } from "hono";
import { logger as honoLogger } from "hono/logger";
import { log } from "../config/logger.js";

export const logging: MiddlewareHandler = honoLogger(
    (msg: string) => {
        log.info(msg);
    }
);
