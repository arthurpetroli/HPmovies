import { HiAnime } from "aniwatch";
import { Hono } from "hono";
import { cache } from "../config/cache.js";
import type { ServerContext } from "../config/context.js";

const hianime = new HiAnime.Scraper();
const hianimeRouter = new Hono<ServerContext>();

// /api/v2/hianime
hianimeRouter.get("/", (c) => c.redirect("/", 301));

// /api/v2/hianime/home
hianimeRouter.get("/home", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");

    const data = await cache.getOrSet<HiAnime.ScrapedHomePage>(
        hianime.getHomePage,
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/azlist/{sortOption}?page={page}
hianimeRouter.get("/azlist/:sortOption", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");

    const sortOption = decodeURIComponent(
        c.req.param("sortOption").trim().toLowerCase()
    ) as HiAnime.AZListSortOptions;
    const page: number =
        Number(decodeURIComponent(c.req.query("page") || "")) || 1;

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeAZList>(
        async () => hianime.getAZList(sortOption, page),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/qtip/{animeId}
hianimeRouter.get("/qtip/:animeId", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeId = decodeURIComponent(c.req.param("animeId").trim());

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeQtipInfo>(
        async () => hianime.getQtipInfo(animeId),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/category/{name}?page={page}
hianimeRouter.get("/category/:name", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const categoryName = decodeURIComponent(
        c.req.param("name").trim()
    ) as HiAnime.AnimeCategories;
    const page: number =
        Number(decodeURIComponent(c.req.query("page") || "")) || 1;

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeCategory>(
        async () => hianime.getCategoryAnime(categoryName, page),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/genre/{name}?page={page}
hianimeRouter.get("/genre/:name", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const genreName = decodeURIComponent(c.req.param("name").trim());
    const page: number =
        Number(decodeURIComponent(c.req.query("page") || "")) || 1;

    const data = await cache.getOrSet<HiAnime.ScrapedGenreAnime>(
        async () => hianime.getGenreAnime(genreName, page),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/producer/{name}?page={page}
hianimeRouter.get("/producer/:name", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const producerName = decodeURIComponent(c.req.param("name").trim());
    const page: number =
        Number(decodeURIComponent(c.req.query("page") || "")) || 1;

    const data = await cache.getOrSet<HiAnime.ScrapedProducerAnime>(
        async () => hianime.getProducerAnimes(producerName, page),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/schedule?date={date}&tzOffset={tzOffset}
hianimeRouter.get("/schedule", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");

    const date = decodeURIComponent(c.req.query("date") || "");
    let tzOffset = Number(
        decodeURIComponent(c.req.query("tzOffset") || "-330")
    );
    tzOffset = isNaN(tzOffset) ? -330 : tzOffset;

    const data = await cache.getOrSet<HiAnime.ScrapedEstimatedSchedule>(
        async () => hianime.getEstimatedSchedule(date, tzOffset),
        `${cacheConfig.key}_${tzOffset}`,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/search?q={query}&page={page}&filters={...filters}
hianimeRouter.get("/search", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    let { q: query, page, ...filters } = c.req.query();

    query = decodeURIComponent(query || "");
    const pageNo = Number(decodeURIComponent(page || "")) || 1;

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeSearchResult>(
        async () => hianime.search(query, pageNo, filters),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/search/suggestion?q={query}
hianimeRouter.get("/search/suggestion", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const query = decodeURIComponent(c.req.query("q") || "");

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeSearchSuggestion>(
        async () => hianime.searchSuggestions(query),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/anime/{animeId}
hianimeRouter.get("/anime/:animeId", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeId = decodeURIComponent(c.req.param("animeId").trim());

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeAboutInfo>(
        async () => hianime.getInfo(animeId),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/episode/servers?animeEpisodeId={id}
hianimeRouter.get("/episode/servers", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeEpisodeId = decodeURIComponent(
        c.req.query("animeEpisodeId") || ""
    );

    const data = await cache.getOrSet<HiAnime.ScrapedEpisodeServers>(
        async () => hianime.getEpisodeServers(animeEpisodeId),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// episodeId=steinsgate-3?ep=230
// /api/v2/hianime/episode/sources?animeEpisodeId={episodeId}?server={server}&category={category (dub or sub)}
hianimeRouter.get("/episode/sources", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeEpisodeId = decodeURIComponent(
        c.req.query("animeEpisodeId") || ""
    );
    const server = decodeURIComponent(
        c.req.query("server") || HiAnime.Servers.VidStreaming
    ) as HiAnime.AnimeServers;
    const category = decodeURIComponent(c.req.query("category") || "sub") as
        | "sub"
        | "dub"
        | "raw";

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeEpisodesSources>(
        async () => hianime.getEpisodeSources(animeEpisodeId, server, category),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/anime/{anime-id}/episodes
hianimeRouter.get("/anime/:animeId/episodes", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeId = decodeURIComponent(c.req.param("animeId").trim());

    const data = await cache.getOrSet<HiAnime.ScrapedAnimeEpisodes>(
        async () => hianime.getEpisodes(animeId),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// /api/v2/hianime/anime/{anime-id}/next-episode-schedule
hianimeRouter.get("/anime/:animeId/next-episode-schedule", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeId = decodeURIComponent(c.req.param("animeId").trim());

    const data = await cache.getOrSet<HiAnime.ScrapedNextEpisodeSchedule>(
        async () => hianime.getNextEpisodeSchedule(animeId),
        cacheConfig.key,
        cacheConfig.duration
    );

    return c.json({ status: 200, data }, { status: 200 });
});

// Verifique se a rota está definida assim:

hianimeRouter.get("/anime/info/:id", async (c) => {
    const cacheConfig = c.get("CACHE_CONFIG");
    const animeId = c.req.param("id");

    console.log("🎯 Received anime ID:", animeId);

    try {
        const data = await cache.getOrSet<HiAnime.ScrapedAnimeAboutInfo>(
            async () => hianime.getInfo(animeId),
            cacheConfig.key,
            cacheConfig.duration
        );

        return c.json({ status: 200, data }, { status: 200 });
    } catch (error: any) {
        console.error("❌ Error fetching anime info:", error);
        return c.json(
            {
                success: false,
                message: error?.message || "Failed to fetch anime info",
            },
            error?.status || 500
        );
    }
});

// /api/v2/hianime/proxy-stream?url={encodedUrl}
hianimeRouter.get("/proxy-stream", async (c) => {
    try {
        const encodedUrl = c.req.query("url");
        if (!encodedUrl) {
            return c.json({ error: "URL parameter is required" }, 400);
        }

        const url = decodeURIComponent(encodedUrl);
        const referer = c.req.query("referer") || "https://megacloud.blog/";

        // Buscar o conteúdo com os headers corretos
        const response = await fetch(url, {
            headers: {
                Referer: referer,
                Origin: new URL(referer).origin,
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Accept: "*/*",
                "X-Requested-With": "XMLHttpRequest",
            },
        });

        if (!response.ok) {
            console.error(`Proxy upstream error: ${response.status} ${response.statusText} for URL: ${url}`);
            return c.json(
                { error: `Failed to fetch stream: ${response.statusText}` },
                response.status as any
            );
        }

        // Pegar o content-type
        const contentType =
            response.headers.get("content-type") ||
            "application/vnd.apple.mpegurl";

        // Se for um arquivo m3u8, precisamos reescrever as URLs internas para também passarem pelo proxy
        if (contentType.includes("mpegurl") || contentType.includes("m3u8")) {
            const body = await response.text();
            const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
            const modifiedBody = body
                .split("\n")
                .map((line) => {
                    // Se a linha não é um comentário e não começa com http
                    if (
                        !line.startsWith("#") &&
                        line.trim()
                    ) {
                        const fullUrl = line.startsWith("http") ? line : (line.startsWith("/")
                            ? new URL(line, baseUrl).href
                            : baseUrl + line);
                        // Reescrever para passar pelo proxy
                        return `/api/v2/hianime/proxy-stream?url=${encodeURIComponent(fullUrl)}&referer=${encodeURIComponent(referer)}`;
                    }
                    return line;
                })
                .join("\n");

            return c.text(modifiedBody, 200, {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers":
                    "Range, Accept, Accept-Language, Content-Type",
                "Cache-Control": "no-cache",
            });
        }

        // Para outros tipos de conteúdo (segmentos .ts, etc), apenas retornar o conteúdo
        const arrayBuffer = await response.arrayBuffer();
        return c.body(arrayBuffer, 200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers":
                "Range, Accept, Accept-Language, Content-Type",
            "Cache-Control": "public, max-age=3600",
        });
    } catch (error: any) {
        console.error("Proxy stream error:", error);
        return c.json(
            { error: error.message || "Failed to proxy stream" },
            500
        );
    }
});

export { hianimeRouter };
