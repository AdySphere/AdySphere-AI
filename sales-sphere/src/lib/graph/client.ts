import type { CallLogger, FetchLike } from "../audit";

const GRAPH = "https://graph.microsoft.com/v1.0";
// PidTagDeferredSendTime: Exchange holds the message until this time once it is sent.
const DEFERRED_SEND = "SystemTime 0x3FEF";

export type GraphMessage = {
  id: string;
  conversationId: string;
  subject: string;
  isDraft?: boolean;
  sentDateTime?: string | null;
  receivedDateTime?: string;
  from?: { emailAddress: { address: string; name?: string } };
  toRecipients?: { emailAddress: { address: string } }[];
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  webLink?: string;
};

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class GraphClient {
  constructor(
    private opts: { getAccessToken: () => Promise<string>; logger: CallLogger; fetch?: FetchLike; mailbox?: string },
  ) {}

  private async call<T>(method: string, path: string, operation: string, body?: unknown): Promise<T> {
    const token = await this.opts.getAccessToken();
    const res = await (this.opts.fetch ?? fetch)(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.body-content-type="html"',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await this.opts.logger.log({ provider: "graph", operation, costUnit: "none", status: res.ok ? "ok" : "error", meta: { status: res.status, mailbox: this.opts.mailbox } });
    if (!res.ok) throw new GraphError(res.status, `Graph ${operation} failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
    if (res.status === 202 || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  me() {
    return this.call<{ id: string; mail: string | null; userPrincipalName: string; displayName: string }>("GET", "/me?$select=id,mail,userPrincipalName,displayName", "me");
  }

  /** Creates a draft in the signed-in user's Drafts folder. Never sends. */
  createDraft(p: { subject: string; html: string; to: { email: string; name?: string }; deferredSendAt?: Date | null }) {
    return this.call<GraphMessage>("POST", "/me/messages", "create_draft", {
      subject: p.subject,
      body: { contentType: "HTML", content: p.html },
      toRecipients: [{ emailAddress: { address: p.to.email, name: p.to.name } }],
      ...(p.deferredSendAt ? { singleValueExtendedProperties: [{ id: DEFERRED_SEND, value: p.deferredSendAt.toISOString() }] } : {}),
    });
  }

  /** Creates a reply draft in the same thread, then puts our text above the quoted original. */
  async createReplyDraft(messageId: string, p: { html: string; deferredSendAt?: Date | null }) {
    const draft = await this.call<GraphMessage>("POST", `/me/messages/${encodeURIComponent(messageId)}/createReply`, "create_reply_draft", {});
    const quoted = draft.body?.content ?? "";
    return this.call<GraphMessage>("PATCH", `/me/messages/${encodeURIComponent(draft.id)}`, "update_draft", {
      body: { contentType: "HTML", content: `${p.html}${quoted}` },
      ...(p.deferredSendAt ? { singleValueExtendedProperties: [{ id: DEFERRED_SEND, value: p.deferredSendAt.toISOString() }] } : {}),
    });
  }

  updateDraft(id: string, p: { subject?: string; html?: string }) {
    return this.call<GraphMessage>("PATCH", `/me/messages/${encodeURIComponent(id)}`, "update_draft", {
      ...(p.subject !== undefined ? { subject: p.subject } : {}),
      ...(p.html !== undefined ? { body: { contentType: "HTML", content: p.html } } : {}),
    });
  }

  deleteMessage(id: string) {
    return this.call<void>("DELETE", `/me/messages/${encodeURIComponent(id)}`, "delete_message");
  }

  /** Only called for mailboxes with "allow send" on, for a batch the user approved. */
  sendDraft(id: string) {
    return this.call<void>("POST", `/me/messages/${encodeURIComponent(id)}/send`, "send_draft");
  }

  getMessage(id: string) {
    return this.call<GraphMessage>("GET", `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,isDraft,sentDateTime`, "get_message");
  }

  async listConversation(conversationId: string): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`);
    const r = await this.call<{ value: GraphMessage[] }>(
      "GET",
      `/me/messages?$filter=${filter}&$select=id,conversationId,subject,isDraft,sentDateTime,receivedDateTime,from,toRecipients,bodyPreview,body&$top=50`,
      "list_conversation",
    );
    return r.value;
  }

  async listInboxSince(since: Date): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const r = await this.call<{ value: GraphMessage[] }>(
      "GET",
      `/me/mailFolders/inbox/messages?$filter=${filter}&$select=id,conversationId,subject,receivedDateTime,from,bodyPreview,body&$orderby=receivedDateTime desc&$top=100`,
      "list_inbox",
    );
    return r.value;
  }
}
