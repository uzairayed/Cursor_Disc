import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { google } from "googleapis";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GmailNotConnectedError extends Error {
  constructor(message = "Gmail not connected; run setup") {
    super(message);
    this.name = "GmailNotConnectedError";
  }
}

export interface GmailMessageSummary {
  id: string;
  subject: string;
  from: string;
  date: string;
}

export interface GmailTransport {
  isConnected: () => boolean;
  listUnread: (max: number) => Promise<GmailMessageSummary[]>;
}

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
}

export function formatInboxSummary(messages: GmailMessageSummary[]): string {
  if (messages.length === 0) return "You have no unread emails.";
  const lines = messages.map(
    (m, i) =>
      `${i + 1}. ${m.subject || "(no subject)"} from ${m.from || "unknown"}, ${m.date || "unknown date"}.`
  );
  return `You have ${messages.length} unread email${messages.length === 1 ? "" : "s"}. ${lines.join(" ")}`;
}

export async function listUnreadMessages(opts: {
  transport: GmailTransport;
  max?: number;
}): Promise<GmailMessageSummary[]> {
  if (!opts.transport.isConnected()) throw new GmailNotConnectedError();
  const max = Math.max(1, Math.min(opts.max ?? 5, 20));
  return opts.transport.listUnread(max);
}

export function loadGmailConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  rootDir?: string
): GmailConfig | null {
  const clientId = env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    env.GMAIL_REDIRECT_URI?.trim() || "http://127.0.0.1:53682/oauth2callback";
  const tokenPath =
    env.GMAIL_TOKEN_PATH?.trim() ||
    (rootDir ? `${rootDir}/.secrets/gmail-token.json` : ".secrets/gmail-token.json");
  return { clientId, clientSecret, redirectUri, tokenPath };
}

export function createOAuth2Client(config: GmailConfig): OAuth2Client {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export function getGmailAuthUrl(config: GmailConfig): string {
  const client = createOAuth2Client(config);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
  });
}

export async function exchangeGmailCode(
  config: GmailConfig,
  code: string
): Promise<void> {
  const client = createOAuth2Client(config);
  const { tokens } = await client.getToken(code);
  mkdirSync(dirname(config.tokenPath), { recursive: true });
  writeFileSync(config.tokenPath, JSON.stringify(tokens, null, 2), "utf8");
}

function loadSavedTokens(tokenPath: string): Record<string, unknown> | null {
  if (!existsSync(tokenPath)) return null;
  try {
    return JSON.parse(readFileSync(tokenPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function header(headers: { name?: string | null; value?: string | null }[] | undefined, name: string): string {
  const h = headers?.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return (h?.value ?? "").trim();
}

/** Live Gmail API transport using stored OAuth tokens. */
export function createGmailTransport(config: GmailConfig): GmailTransport {
  const tokens = loadSavedTokens(config.tokenPath);

  return {
    isConnected: () => Boolean(tokens?.access_token || tokens?.refresh_token),
    listUnread: async (max) => {
      const auth = createOAuth2Client(config);
      const saved = loadSavedTokens(config.tokenPath);
      if (!saved) throw new GmailNotConnectedError();
      auth.setCredentials(saved);
      auth.on("tokens", (fresh) => {
        const merged = { ...loadSavedTokens(config.tokenPath), ...fresh };
        mkdirSync(dirname(config.tokenPath), { recursive: true });
        writeFileSync(config.tokenPath, JSON.stringify(merged, null, 2), "utf8");
      });

      const gmail = google.gmail({ version: "v1", auth });
      const list = await gmail.users.messages.list({
        userId: "me",
        q: "is:unread in:inbox",
        maxResults: max,
      });
      const ids = list.data.messages?.map((m) => m.id).filter(Boolean) as string[] | undefined;
      if (!ids?.length) return [];

      const out: GmailMessageSummary[] = [];
      for (const id of ids) {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const headers = msg.data.payload?.headers;
        out.push({
          id,
          subject: header(headers, "Subject") || "(no subject)",
          from: header(headers, "From") || "unknown",
          date: header(headers, "Date") || "unknown date",
        });
      }
      return out;
    },
  };
}
