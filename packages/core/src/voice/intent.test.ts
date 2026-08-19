import { describe, expect, it } from "vitest";
import {
  classifyVoiceIntent,
  containsInterruptIntent,
  isEchoOfSpokenReply,
  isEchoTranscript,
  isInterruptIntent,
  isTooThinForAgent,
} from "./intent.js";

describe("classifyVoiceIntent", () => {
  it("classifies date and time questions", () => {
    expect(classifyVoiceIntent("what's the date")).toEqual({ kind: "datetime" });
    expect(classifyVoiceIntent("what's the date today")).toEqual({ kind: "datetime" });
    expect(classifyVoiceIntent("what is today's date")).toEqual({ kind: "datetime" });
    expect(classifyVoiceIntent("what time is it")).toEqual({ kind: "datetime" });
    expect(classifyVoiceIntent("tell me the date and time")).toEqual({ kind: "datetime" });
    expect(classifyVoiceIntent("what's today's date")).toEqual({ kind: "datetime" });
    expect(classifyVoiceIntent("Hey, what's the time?")).toEqual({ kind: "datetime" });
  });

  it("does not hijack sentences that merely mention date or time", () => {
    expect(classifyVoiceIntent("what's the date of the last commit").kind).toBe("agent");
    expect(classifyVoiceIntent("fix the current time formatting in utils").kind).toBe("agent");
    expect(classifyVoiceIntent("show me where we parse date and time strings").kind).toBe("agent");
  });

  it("detects TTS echo / self-hearing garbage", () => {
    expect(isEchoTranscript("listening, casting the")).toBe(true);
    expect(isEchoTranscript("Listening. Ask me the date")).toBe(true);
    expect(isEchoTranscript("Working on it.")).toBe(true);
    expect(isEchoTranscript("what's the date today")).toBe(false);
  });

  it("flags thin / truncated agent prompts", () => {
    expect(isTooThinForAgent("you")).toBe(true);
    expect(isTooThinForAgent("I was asking what is the latest news for...")).toBe(true);
    expect(isTooThinForAgent("what's the latest news for Kashmir")).toBe(false);
  });

  it("detects barge-in stop phrases", () => {
    expect(isInterruptIntent("stop")).toBe(true);
    expect(isInterruptIntent("shut up")).toBe(true);
    expect(isInterruptIntent("what's the date")).toBe(false);
  });

  it("finds stop words buried in natural or echo-merged speech", () => {
    expect(containsInterruptIntent("okay stop")).toBe(true);
    expect(containsInterruptIntent("please stop talking now")).toBe(true);
    expect(containsInterruptIntent("stop stop stop")).toBe(true);
    expect(containsInterruptIntent("everything looked fine but okay, stop.")).toBe(true);
    expect(containsInterruptIntent("I'm stopping by the office later")).toBe(false);
    expect(containsInterruptIntent("fix the login bug in cliproom")).toBe(false);
  });

  it("recognizes transcripts that are echoes of the bot's own reply", () => {
    const reply = "I've updated the config and restarted the dev server for you.";
    expect(isEchoOfSpokenReply("updated the config and restarted the dev server", reply)).toBe(
      true,
    );
    expect(isEchoOfSpokenReply("fix the login bug in cliproom", reply)).toBe(false);
    // Too short to judge — must never eat brief real prompts.
    expect(isEchoOfSpokenReply("yes", reply)).toBe(false);
  });

  it("classifies bridge commands", () => {
    expect(classifyVoiceIntent("status")).toEqual({ kind: "command", text: "status" });
    expect(classifyVoiceIntent("stop")).toEqual({ kind: "command", text: "stop" });
    expect(classifyVoiceIntent("stop all")).toEqual({ kind: "command", text: "stop all" });
    expect(classifyVoiceIntent("help")).toEqual({ kind: "command", text: "help" });
    expect(classifyVoiceIntent("switch to cliproom")).toEqual({
      kind: "command",
      text: "switch to cliproom",
    });
    expect(classifyVoiceIntent("new chat")).toEqual({ kind: "command", text: "new chat" });
  });

  it("defaults remaining speech to agent", () => {
    expect(classifyVoiceIntent("fix the login bug in cliproom")).toEqual({
      kind: "agent",
      text: "fix the login bug in cliproom",
    });
  });
});
