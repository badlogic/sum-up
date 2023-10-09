import { LitElement, PropertyValueMap, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, query, state } from "lit/decorators.js";
import { globalStyles } from "./styles";

export type AccountSummary = { text: string; displayName: string; avatar: string };

export function get(url: string) {
    if (location.href.includes("localhost")) {
        url = "http://localhost:3333" + url;
    }
    return fetch(url);
}

@customElement("sumup-app")
export class App extends LitElement {
    static styles = [globalStyles];

    @state()
    message?: string;

    @state()
    avatar?: string;

    @state()
    displayName?: string;

    @query("#input")
    input?: HTMLInputElement;

    @query("#load")
    load?: HTMLInputElement;

    loading = false;

    account: string | null;

    constructor() {
        super();
        this.account = new URL(window.location.href).searchParams.get("account");
    }

    protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
        if (this.account) this.hitMe();
    }

    render() {
        return html` <div class="flex flex-col items-center max-w-[600px] m-auto">
            <a class="text-center text-primary font-bold text-2xl my-4" href="/">Sum-up</a>
            <div class="text-center mb-4">See what ChatGPT thinks of your Bluesky feed</div>
            <div class="flex">
                <input
                    id="input"
                    class="flex-1 border rounded-l px-2 py-1"
                    placeholder="Bluesky handle, e.g. badlogic.bsky.social"
                    value="${this.account || nothing}"
                />
                <button id="load" class="bg-primary text-white rounded-r px-4" @click=${() => this.hitMe()}>Hit me</button>
            </div>
            ${this.loading
                ? html`<div class="mt-4 text-center m-auto">
                          Asking ChatGPT to tell you how swell you are. <br />
                          This could take a while. Look at the cat.
                      </div>
                      <img class="w-[100px]" src="cat-nyan-cat.gif" />`
                : nothing}
            ${this.avatar ? html`<img class="my-4 rounded-full max-w-[150px] max-h-[150px]" src="${this.avatar}" />` : nothing}
            ${this.displayName
                ? html`<div class="text-bold text-2xl">${this.displayName}</div>
                      <a class="mb-4 font-bold text-primary text-center" href="${location.href}">Share</a>`
                : nothing}
            ${this.message ? html`<div>${unsafeHTML(this.message)}</div>` : nothing}
            <div class="flex-1"></div>
            <div class="text-center italic mt-4">
                Lovingly made by <a class="text-primary" href="https://bsky.app/profile/badlogic.bsky.social">Mario Zechner</a><br />
                No data is collected, not even your IP address.
                <a class="text-primary" href="https://github.com/badlogic/sum-up"><br />Source code</a>
            </div>
        </div>`;
    }

    async hitMe() {
        this.input!.disabled = true;
        this.load!.disabled = true;

        const account = this.input!.value.trim();
        if (account.length == 0) {
            this.message = "Please specify an account";
            this.input!.disabled = false;
            this.load!.disabled = false;
        }

        this.avatar = undefined;
        this.displayName = undefined;
        this.message = undefined;
        this.loading = true;
        this.requestUpdate();

        const response = await get(`/api/summarize/${account}`);
        if (response.status != 200) {
            this.avatar = undefined;
            this.message = "Whoopsies, something went wrong.";
        } else {
            const reply = (await response.json()) as { accountSummary: { text: string; displayName: string; avatar: string }; gptSummary: string };
            this.avatar = reply.accountSummary.avatar;
            this.displayName = reply.accountSummary.displayName;
            this.message = reply.gptSummary.replace("Summary:", "").trim().replaceAll("\n", "<br>");
            const url = new URL(window.location.href);
            url.searchParams.set("account", account);
            history.replaceState(null, "", url.toString());
        }
        this.input!.disabled = false;
        this.load!.disabled = false;
        this.loading = false;
    }
}
