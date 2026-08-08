import { describe, expect, it } from "vitest";
import {
  classifyVoiceIntent,
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
  });

  it("detects TTS echo / self-hearing garbage", () => {
    expect(isEchoTranscript("listening, casting the")).toBe(true);
    expect(isEchoTranscript("Listening. Ask me the date")).toBe(true);
    expect(isEchoTranscript("Working on it.")).toBe(true);
    expect(isEchoTranscript("what's the date today")).toBe(false);
  });

  it("flags thin / truncated agent prompts", () => {
    expect(isTooThinForAgent("you")).toBe(true);
    expect(isTooThinForAgent("I was asking what is the latest news for...")).toBe(
      true
    );
    expect(isTooThinForAgent("what's the latest news for Kashmir")).toBe(false);
  });

  it("detects barge-in stop phrases", () => {
    expect(isInterruptIntent("stop")).toBe(true);
    expect(isInterruptIntent("shut up")).toBe(true);
    expect(isInterruptIntent("what's the date")).toBe(false);
  });

  it("classifies mail requests", () => {
    expect(classifyVoiceIntent("check my email")).toEqual({ kind: "mail" });
    expect(classifyVoiceIntent("any unread mail")).toEqual({ kind: "mail" });
    expect(classifyVoiceIntent("summarize my inbox")).toEqual({ kind: "mail" });
    expect(classifyVoiceIntent("do I have new emails")).toEqual({ kind: "mail" });
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
