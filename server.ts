import compression from "compression";
import express, { json } from "express";
import * as http from "http";
import cors from "cors"; // Import the cors middleware
import OpenAI from "openai";

const cache = new Map<String, { accountSummary: AccountSummary; gptSummary: string }>();

const port = process.env.PORT ?? 3333;
const openAiKey = process.env.SUMUP_OPENAI;
const blueskyAccount = process.env.SUMUP_BLUESKY_ACCOUNT;
const blueskyPassword = process.env.SUMUP_BLUESKY_PASSWORD;

if (!openAiKey) {
    console.error("No OpenAI key given");
    process.exit(-1);
}

if (!blueskyAccount) {
    console.error("No Bluesky account given");
    process.exit(-1);
}

if (!blueskyPassword) {
    console.error("No Bluesky account given");
    process.exit(-1);
}

const openai = new OpenAI({
    apiKey: openAiKey,
});

let session: BskySession | null = null;

(async () => {
    console.log(`OpenAI key: ${openAiKey}`);
    console.log(`BlueSky account: ${blueskyAccount}`);
    console.log(`BlueSky password: ${blueskyPassword}`);

    session = await createSession(blueskyAccount, blueskyPassword);
    if (!session) process.exit(-1);

    setInterval(async () => {
        session = await createSession(blueskyAccount, blueskyPassword);
        if (!session) {
            console.log("Couldn't recreate session");
            process.exit(-1);
        }
    }, 60 * 60 * 1000);

    setInterval(() => {
        cache.clear();
        console.log("Cleared cache");
    }, 24 * 60 * 60 * 1000);

    const app = express();
    app.use(cors());
    app.use(compression());
    app.use(json());
    app.use(express.static("site"));
    app.get("/api/clear/:accountName", async (req, res) => {
        const account = req.params.accountName;
        cache.delete(account);
    });
    app.get("/api/summarize/:accountName", async (req, res) => {
        const account = req.params.accountName;
        let type = (req.query.type as string) || "funny";
        let style = (req.query.style as string) || null;
        const key = account + "|" + type + "|" + style;

        console.log(`Summarizing account ${key}`);
        if (cache.has(key)) {
            console.log("Using cached summary for " + key);
            res.json(cache.get(key));
            return;
        }

        try {
            const accountSummary = await getUserPosts(account, session!);
            if (!accountSummary) {
                res.status(400).json({ error: "Account summary not found" });
                return;
            }
            const gptSummary = await getSummary(accountSummary.text, accountSummary.displayName, type, style); // Pass "type" as the third argument
            const result = { accountSummary, gptSummary };
            cache.set(key, result);
            res.json({ accountSummary, gptSummary });
        } catch (e) {
            console.error(`Error`, e);
            res.status(400).json({ error: "An error occurred while processing the request" });
        }
    });

    http.createServer(app).listen(port, () => {
        console.log(`App listening on port ${port}`);
    });
})();

type BskySession = { did: string; handle: string; email: string; accessJwt: string; refreshJwt: string };

async function createSession(accountName: string, password: string): Promise<BskySession | null> {
    const url = "https://bsky.social/xrpc/com.atproto.server.createSession";

    const data = {
        identifier: accountName,
        password: password,
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });

        if (response.ok) {
            const responseData = await response.json();
            console.log("Session created:", responseData);
            return responseData as BskySession;
        } else {
            console.error("Failed to create session:", response.status, response.statusText);
            return null;
        }
    } catch (error) {
        console.error("Error creating session" + JSON.stringify(error, null, 2));
        return null;
    }
}

async function getSummary(userText: string, displayName: string, type: string, style: string | null): Promise<string> {
    style = style?.trim() ?? "";
    style = style && style.length > 0 ? `* The most important rule: you MUST write in the style of ${style}.` : "";
    const prompts: Record<string, string> = {
        funny: `
    summarize this bluesky user's posts. You must honor these rules:
    ${style}
    * the summary should be at least 6 paragraphs long
    * use a super funny and possibly sarcastic writing style for the summary. this is very important.
    * end the summary with a rating for the user that is funny
    * do not ridicule the user or insinuate that they are clueless. this is very important.
    * do not ridicule political, societal, or personal issues. this is very important.
    * use their display name ${displayName}

    Here are the posts, delimited by "|": `,
        serious: `
    summarize this bluesky user's posts. You must honor these rules:
    ${style}
    * the summary should be at least 6 paragraphs long
    * use a serious writing style for the summary
    * end the summary by summarizing what topics other users will find in this users timeline.
    * do not ridicule the user or insinuate that they are clueless. this is very important.
    * do not ridicule political, societal, or personal issues. this is very important.
    * use their display name ${displayName}

    Here are the posts, delimited by "|": `,
    };

    const prompt = prompts[type];
    console.log(prompt);
    try {
        const chatCompletion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt + "\n\n" + userText }],
            model: "gpt-3.5-turbo",
            temperature: 0.8,
        });
        console.log("Got summary for " + displayName);
        return chatCompletion.choices[0].message.content!;
    } catch (error) {
        console.error("Error generating response:", error);
        throw error;
    }
}

export type BskyFeed = {
    cursor: string;
    feed: BskyPost[];
};

export type BskyPost = {
    post: {
        author: {
            avatar: string;
            did: string;
            displayName: string;
            handle: string;
        };
        record: {
            text: string;
        };
    };
    reason?: any;
};

export type AccountSummary = { text: string; displayName: string; avatar: string };

async function getUserPosts(account: string, session: BskySession): Promise<AccountSummary | null> {
    try {
        account = account.replaceAll("@", "").toLowerCase();
        if (!account.includes(".")) account = account + "bsky.social";
        const url = new URL("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed");
        url.searchParams.append("actor", account);
        url.searchParams.append("limit", (55).toString());

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Authorization: `Bearer ${session.accessJwt}`,
            },
        });
        if (response.status != 200) return null;
        const feed = (await response.json()) as BskyFeed;
        feed.feed = feed.feed.filter((post) => post.post.author.handle == account && !post.reason);
        const text = feed.feed.map((post) => post.post.record.text).join(" | ");
        console.log("Got user posts for " + account);
        return { text, displayName: feed.feed[0].post.author.displayName, avatar: feed.feed[0].post.author.avatar };
    } catch (e) {
        console.error("Error fetching posts for " + account, e);
        return null;
    }
}
