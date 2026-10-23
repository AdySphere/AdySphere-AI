import { describe, expect, it } from "vitest";
import { GraphClient } from "@/lib/graph/client";
import { createOutlookDraft, DailyCapError, FooterIncompleteError } from "@/lib/drafts/outlook";
import { composeEmailHtml, stripSignOff } from "@/lib/drafts/compose";
import { MemoryCallLogger } from "@/lib/audit";
import { mockFetch } from "./helpers";

const mailbox = {
  email: "mallicka@adysphere.com",
  personaName: "Adyasha",
  signOff: "Best,",
  signatureHtml: '<table><tr><td>Adyasha Mallick</td></tr></table><img src="https://x/logo.png">',
  dailyDraftLimit: 2,
};
const draft = { kind: "initial" as const, subject: "your d365 admin role", body: "Hi Sam,\n\nSaw the D365 admin role.\n\nWorth a quick chat next week?", toEmail: "sam@acme.com", toName: "Sam K", scheduledFor: new Date("2026-10-26T12:30:00Z") };

function graphMock() {
  const m = mockFetch((req) => {
    if (req.method === "POST" && req.url.endsWith("/me/messages")) return { status: 201, json: { id: "AAMk1", conversationId: "conv1", subject: "x" } };
    if (req.url.includes("/createReply")) return { status: 201, json: { id: "AAMk2", conversationId: "conv1", body: { contentType: "html", content: "<div>quoted</div>" } } };
    if (req.method === "PATCH") return { json: { id: "AAMk2", conversationId: "conv1" } };
    return { status: 404 };
  });
  const graph = new GraphClient({ getAccessToken: async () => "tok", logger: new MemoryCallLogger(), fetch: m.fetch });
  return { graph, calls: m.calls };
}

describe("createOutlookDraft (mocked Graph)", () => {
  it("creates a draft (never sends) with signature, footer and deferred send time", async () => {
    const { graph, calls } = graphMock();
    const r = await createOutlookDraft({ graph, mailbox, draft, footerTemplate: "Reply \"no thanks\" to opt out.", physicalAddress: "", draftsCreatedToday: 0 });
    expect(r).toMatchObject({ id: "AAMk1", conversationId: "conv1" });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(c.method).toBe("POST");
    expect(calls.some((x) => x.url.endsWith("/send"))).toBe(false);
    expect(c.headers.Authorization).toBe("Bearer tok");
    const body = c.body as { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[]; singleValueExtendedProperties: { id: string; value: string }[] };
    expect(body.subject).toBe("your d365 admin role");
    expect(body.toRecipients[0]!.emailAddress.address).toBe("sam@acme.com");
    expect(body.body.content).toContain("Best,<br>Adyasha");
    expect(body.body.content).toContain("<table><tr><td>Adyasha Mallick</td></tr></table>");
    expect(body.body.content).not.toContain("<img");
    expect(body.body.content).toContain("opt out");
    expect(body.singleValueExtendedProperties).toEqual([{ id: "SystemTime 0x3FEF", value: "2026-10-26T12:30:00.000Z" }]);
  });

  it("enforces the hard daily cap without calling Graph", async () => {
    const { graph, calls } = graphMock();
    await expect(createOutlookDraft({ graph, mailbox, draft, footerTemplate: "", physicalAddress: "", draftsCreatedToday: 2 })).rejects.toBeInstanceOf(DailyCapError);
    expect(calls).toHaveLength(0);
  });

  it("refuses a US footer without a physical address", async () => {
    const { graph, calls } = graphMock();
    await expect(createOutlookDraft({ graph, mailbox, draft, footerTemplate: "AdySphere Co · {{physical_address}}", physicalAddress: "", draftsCreatedToday: 0 })).rejects.toBeInstanceOf(FooterIncompleteError);
    expect(calls).toHaveLength(0);
  });

  it("creates follow-ups as replies in the same thread, above the quoted original", async () => {
    const { graph, calls } = graphMock();
    const r = await createOutlookDraft({ graph, mailbox, draft: { ...draft, kind: "followup1", replyToMessageId: "SENT1" }, footerTemplate: "", physicalAddress: "", draftsCreatedToday: 0 });
    expect(r.conversationId).toBe("conv1");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://graph.microsoft.com/v1.0", "")}`)).toEqual(["POST /me/messages/SENT1/createReply", "PATCH /me/messages/AAMk2"]);
    const html = (calls[1]!.body as { body: { content: string } }).body.content;
    expect(html.indexOf("Saw the D365")).toBeLessThan(html.indexOf("quoted"));
  });
});

describe("compose", () => {
  it("strips a sign-off Claude added and escapes HTML", () => {
    expect(stripSignOff("Hi,\n\nText.\n\nBest,\nAdyasha", "Adyasha")).toBe("Hi,\n\nText.");
    const html = composeEmailHtml({ body: "Hi <b>Sam</b>", signOff: "Best,", personaName: "Adyasha", signatureHtml: "", footer: "" });
    expect(html).toContain("Hi &lt;b&gt;Sam&lt;/b&gt;");
  });
});
