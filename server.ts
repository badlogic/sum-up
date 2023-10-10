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

(async () => {
    console.log(`OpenAI key: ${openAiKey}`);
    console.log(`BlueSky account: ${blueskyAccount}`);
    console.log(`BlueSky password: ${blueskyPassword}`);

    const session = await createSession(blueskyAccount, blueskyPassword);
    if (!session) process.exit(-1);

    const app = express();
    app.use(cors());
    app.use(compression());
    app.use(json());
    app.use(express.static("site"));
    app.get("/api/summarize/:accountName", async (req, res) => {
        const account = req.params.accountName;
        console.log(`Summarizing account ${account}`);
        if (cache.has(account)) {
            res.json(cache.get(account));
            return;
        }

        try {
            const accountSummary = await getUserPosts(account, session);
            if (!accountSummary) {
                res.status(400);
                return;
            }
            const gptSummary = await getSummary(accountSummary.text, accountSummary.displayName);
            const result = { accountSummary, gptSummary };
            cache.set(account, result);
            res.json({ accountSummary, gptSummary });
        } catch (e) {
            console.log(`Error ${JSON.stringify(e, null, 2)}`);
            res.status(400);
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

async function getSummary(userText: string, displayName: string): Promise<string> {
    const prompt = `
    summarize this bluesky user's posts in a humorous way. the summary should be at least 6 paragraphs long. don't make it a direct summary, but make the summary kind of about the person themselves. use sarcasm to spice things up. it's ok to be sarcastically negative, but do not be mean. their display name is ${displayName}.`;
    try {
        const chatCompletion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt + "\n\n" + userText }],
            model: "gpt-3.5-turbo",
            temperature: 0.7,
        });
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
};

export type AccountSummary = { text: string; displayName: string; avatar: string };

async function getUserPosts(account: string, session: BskySession): Promise<AccountSummary | null> {
    account = account.replaceAll("@", "");
    const url = new URL("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed");
    url.searchParams.append("actor", account);
    url.searchParams.append("limit", (75).toString());

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
            Authorization: `Bearer ${session.accessJwt}`,
        },
    });
    if (response.status != 200) return null;
    const feed = (await response.json()) as BskyFeed;
    const text = feed.feed
        .filter((post) => post.post.author.handle == account)
        .map((post) => post.post.record.text)
        .join(" ");
    return { text, displayName: feed.feed[0].post.author.displayName, avatar: feed.feed[0].post.author.avatar };
}
