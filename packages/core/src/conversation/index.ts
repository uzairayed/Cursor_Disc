import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface ConversationState {
  project: string;
  chatId: string | null;
  messages: ConversationMessage[];
  updatedAt: string;
}

export class ConversationManager {
  constructor(private readonly historyDir: string) {
    mkdirSync(historyDir, { recursive: true });
  }

  private dirFor(project: string): string {
    return join(this.historyDir, project.toLowerCase());
  }

  private fileFor(project: string): string {
    return join(this.dirFor(project), "conversation.json");
  }

  load(project: string): ConversationState {
    const file = this.fileFor(project);
    if (!existsSync(file)) {
      return {
        project: project.toLowerCase(),
        chatId: null,
        messages: [],
        updatedAt: new Date().toISOString(),
      };
    }
    return JSON.parse(readFileSync(file, "utf8")) as ConversationState;
  }

  save(state: ConversationState): void {
    mkdirSync(this.dirFor(state.project), { recursive: true });
    state.updatedAt = new Date().toISOString();
    writeFileSync(this.fileFor(state.project), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  append(
    project: string,
    userPrompt: string,
    assistantReply: string,
    chatId?: string | null
  ): ConversationState {
    const state = this.load(project);
    state.messages.push(
      { role: "user", content: userPrompt, at: new Date().toISOString() },
      { role: "assistant", content: assistantReply, at: new Date().toISOString() }
    );
    if (chatId !== undefined) state.chatId = chatId;
    if (state.messages.length > 200) {
      state.messages = state.messages.slice(-200);
    }
    this.save(state);
    return state;
  }

  setChatId(project: string, chatId: string | null): void {
    const state = this.load(project);
    state.chatId = chatId;
    this.save(state);
  }

  getChatId(project: string): string | null {
    return this.load(project).chatId;
  }

  /**
   * Clear Cursor chat ids for a project and every namespaced session
   * (`project__discord:…`). Used by "new chat" so parent-channel slash
   * commands also reset thread sessions.
   */
  clearProjectSessions(projectKey: string): number {
    const key = projectKey.toLowerCase();
    const prefix = `${key}__`;
    let cleared = 0;
    if (existsSync(this.historyDir)) {
      for (const name of readdirSync(this.historyDir)) {
        if (name !== key && !name.startsWith(prefix)) continue;
        this.setChatId(name, null);
        cleared += 1;
      }
    }
    if (cleared === 0) {
      this.setChatId(key, null);
      cleared = 1;
    }
    return cleared;
  }
}
