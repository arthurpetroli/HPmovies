import { env } from "../config/env.js";
import { AniwatchAPICache, cache } from "../config/cache.js";
import type { BlankInput } from "hono/types";
import type { Context, MiddlewareHandler, Handler } from "hono";
import type { ServerContext } from "../config/context.js";

// Define middleware to add Cache-Control header
export const cacheControl: MiddlewareHandler = async (c, next) => {
    const sMaxAge = env.ANIWATCH_API_S_MAXAGE;
    const staleWhileRevalidate = env.ANIWATCH_API_STALE_WHILE_REVALIDATE;

    c.header(
        "Cache-Control",
        `s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`
    );

    await next();
};

export function cacheConfigSetter(): MiddlewareHandler {
    return async (c, next) => {
        const url = new URL(c.req.url);
        url.searchParams.sort();

        const requestedDuration = Number(
            c.req.header(AniwatchAPICache.CACHE_EXPIRY_HEADER_NAME) ||
                AniwatchAPICache.DEFAULT_CACHE_EXPIRY_SECONDS
        );
        const duration = Number.isFinite(requestedDuration)
            ? Math.min(3600, Math.max(1, Math.floor(requestedDuration)))
            : AniwatchAPICache.DEFAULT_CACHE_EXPIRY_SECONDS;
        c.set("CACHE_CONFIG", {
            key: `legacy:${url.pathname}${url.search}`,
            duration,
        });

        if (AniwatchAPICache.enabled) {
            c.header(
                AniwatchAPICache.CACHE_EXPIRY_HEADER_NAME,
                duration.toString()
            );
        }

        await next();
    };
}

//  FIXED: add explicit return type
export function withCache<T, P extends string = string>(
    getData: (c: Context<ServerContext, P, BlankInput>) => Promise<T>
): Handler<ServerContext, P, BlankInput> {
    return async (c: Context<ServerContext, P, BlankInput>) => {
        const cacheConfig = c.get("CACHE_CONFIG");

        const data = await cache.getOrSet<T>(
            () => getData(c),
            cacheConfig.key,
            cacheConfig.duration
        );

        return c.json({ status: 200, data }, { status: 200 });
    };
}
