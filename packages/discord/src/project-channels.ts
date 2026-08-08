import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Discord channel names: lowercase, a–z 0–9 hyphen, max 100. */
export function sanitizeDiscordChannelName(projectKey: string): string {
  const cleaned = projectKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cleaned || "project";
}

type RegistryData = Record<string, Record<string, string>>;

export class ProjectChannelRegistry {
  private data: RegistryData = {};

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.data = {};
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      this.data =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as RegistryData)
          : {};
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }

  get(guildId: string, projectKey: string): string | null {
    return this.data[guildId]?.[projectKey.toLowerCase()] ?? null;
  }

  set(guildId: string, projectKey: string, channelId: string): void {
    const key = projectKey.toLowerCase();
    if (!this.data[guildId]) this.data[guildId] = {};
    this.data[guildId]![key] = channelId;
    this.save();
  }

  channelIdsForGuild(guildId: string | null | undefined): string[] {
    if (!guildId) return [];
    return Object.values(this.data[guildId] ?? {});
  }

  /** Reverse lookup: which project owns this channel (or thread parent). */
  findProjectByChannelId(
    guildId: string | null | undefined,
    channelId: string,
    parentChannelId?: string | null
  ): string | null {
    if (!guildId) return null;
    const map = this.data[guildId] ?? {};
    for (const [projectKey, id] of Object.entries(map)) {
      if (id === channelId || (parentChannelId && id === parentChannelId)) {
        return projectKey;
      }
    }
    return null;
  }

  /** True when this channel id is already bound to a different project key. */
  isChannelOwnedByOtherProject(
    guildId: string,
    channelId: string,
    projectKey: string
  ): boolean {
    const owner = this.findProjectByChannelId(guildId, channelId);
    if (!owner) return false;
    return owner !== projectKey.toLowerCase();
  }
}

export interface EnsureProjectChannelResult {
  channelId: string;
  created: boolean;
  name: string;
}

export async function ensureProjectChannel(opts: {
  guildId: string;
  projectKey: string;
  registry: ProjectChannelRegistry;
  findChannelByName: (name: string) => Promise<{ id: string; name: string } | null>;
  createChannel: (name: string) => Promise<{ id: string; name: string }>;
  channelExists: (channelId: string) => Promise<boolean>;
}): Promise<EnsureProjectChannelResult> {
  const baseName = sanitizeDiscordChannelName(opts.projectKey);
  const existingId = opts.registry.get(opts.guildId, opts.projectKey);

  if (existingId && (await opts.channelExists(existingId))) {
    return { channelId: existingId, created: false, name: baseName };
  }

  const found = await opts.findChannelByName(baseName);
  if (
    found &&
    !opts.registry.isChannelOwnedByOtherProject(
      opts.guildId,
      found.id,
      opts.projectKey
    )
  ) {
    opts.registry.set(opts.guildId, opts.projectKey, found.id);
    return { channelId: found.id, created: false, name: baseName };
  }

  const name = await allocateUniqueChannelName({
    baseName,
    projectKey: opts.projectKey,
    findChannelByName: opts.findChannelByName,
  });
  const created = await opts.createChannel(name);
  opts.registry.set(opts.guildId, opts.projectKey, created.id);
  return { channelId: created.id, created: true, name };
}

/** Pick a Discord channel name that does not already exist in the guild. */
async function allocateUniqueChannelName(opts: {
  baseName: string;
  findChannelByName: (name: string) => Promise<{ id: string; name: string } | null>;
  projectKey: string;
}): Promise<string> {
  for (let n = 0; n < 50; n++) {
    const candidate =
      n === 0 ? opts.baseName : `${opts.baseName.slice(0, 96)}-${n + 1}`;
    const found = await opts.findChannelByName(candidate);
    if (!found) return candidate;
  }
  return `${opts.baseName.slice(0, 90)}-${opts.projectKey
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8)}`;
}
