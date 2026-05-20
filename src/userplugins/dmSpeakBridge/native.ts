/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { Readable } from "stream";

// Python(streamlit)からのHTTPを受けてrendererに橋渡しするっす。
// hono(Web標準fetchベース)をNodeのhttpサーバーに繋ぐためにrequest/response変換を挟むっす。
// @hono/node-serverを足すと簡潔になるっすけど、依存を増やさず純httpで完結させてるっす

interface SendRequest {
    channelId: string;
    content: string;
}

interface ChannelInfo {
    id: string;
    name: string;
    parent?: string | null;
}

interface GuildInfo {
    id: string;
    name: string;
}

interface State {
    guilds: GuildInfo[];
    dms: ChannelInfo[];
    channelsByGuild: Record<string, ChannelInfo[]>;
    updatedAt: number;
}

let server: Server | null = null;
let currentPort = 0;
const pendingQueue: SendRequest[] = [];
type Waiter = (items: SendRequest[]) => void;
const waiters: Waiter[] = [];

let cachedState: State = {
    guilds: [],
    dms: [],
    channelsByGuild: {},
    updatedAt: 0,
};

function flushQueue() {
    if (pendingQueue.length === 0) return;
    while (waiters.length > 0 && pendingQueue.length > 0) {
        const w = waiters.shift()!;
        const items = pendingQueue.splice(0, pendingQueue.length);
        w(items);
    }
}

// --- honoでルーティング ---
const app = new Hono();
app.use("*", cors());

app.get("/ping", c => c.json({ ok: true, port: currentPort, queue: pendingQueue.length }));
app.get("/state", c => c.json(cachedState));
app.post("/send", async c => {
    let body: SendRequest;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "invalid json" }, 400);
    }
    if (!body?.channelId || typeof body.content !== "string") {
        return c.json({ error: "channelId and content required" }, 400);
    }
    pendingQueue.push(body);
    console.log("[DMSpeakBridge] queued send to", body.channelId, "queue size:", pendingQueue.length);
    flushQueue();
    return c.json({ ok: true });
});

// --- Node http ⇄ Web Request/Response 橋渡し ---
function toWebRequest(req: IncomingMessage): Request {
    const host = req.headers.host ?? "127.0.0.1";
    const url = `http://${host}${req.url ?? "/"}`;
    const method = req.method ?? "GET";
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v == null) continue;
        if (Array.isArray(v)) v.forEach(item => headers.append(k, item));
        else headers.set(k, v);
    }
    const init: RequestInit & { duplex?: string; } = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
        // Node18+: Readable.toWeb でWebStreamsに変換できるっす
        init.body = Readable.toWeb(req) as any;
        init.duplex = "half";
    }
    return new Request(url, init as RequestInit);
}

async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {};
    webRes.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(webRes.status, headers);
    if (!webRes.body) {
        res.end();
        return;
    }
    // Web ReadableStream → Node Readableに変換してパイプっす
    const nodeStream = Readable.fromWeb(webRes.body as any);
    nodeStream.pipe(res);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
        const webReq = toWebRequest(req);
        const webRes = await app.fetch(webReq);
        await writeWebResponse(webRes, res);
    } catch (e: any) {
        console.error("[DMSpeakBridge] handler error:", e);
        if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(e?.message ?? e) }));
        } else {
            res.end();
        }
    }
}

export function start(_: unknown, port: number): { ok: boolean; port: number; } {
    if (server && currentPort === port) {
        console.log("[DMSpeakBridge] server already running on", port);
        return { ok: true, port };
    }
    if (server) {
        try { server.close(); } catch { /* ignore */ }
        server = null;
    }
    const s = createServer(handleRequest);
    s.on("error", err => console.error("[DMSpeakBridge] server error:", err));
    s.on("listening", () => console.log("[DMSpeakBridge] listening on 127.0.0.1:" + port));
    // 127.0.0.1にだけバインドして外部公開を避けるっす
    s.listen(port, "127.0.0.1");
    server = s;
    currentPort = port;
    return { ok: true, port };
}

export function updateState(_: unknown, state: State): void {
    cachedState = { ...state, updatedAt: Date.now() };
}

// renderer側がこれをループで呼ぶっす。アイテムが無ければ最大timeoutMs待ってから空配列で返すっす
export function pollPending(_: unknown, timeoutMs: number): Promise<SendRequest[]> {
    return new Promise(resolve => {
        if (pendingQueue.length > 0) {
            resolve(pendingQueue.splice(0, pendingQueue.length));
            return;
        }
        const timer = setTimeout(() => {
            const idx = waiters.indexOf(waiter);
            if (idx >= 0) waiters.splice(idx, 1);
            resolve([]);
        }, Math.max(1000, Math.min(60_000, timeoutMs)));
        const waiter: Waiter = items => {
            clearTimeout(timer);
            resolve(items);
        };
        waiters.push(waiter);
    });
}
