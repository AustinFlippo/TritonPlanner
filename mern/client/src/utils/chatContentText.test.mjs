import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatContentText } from "./chatContentText.js";

describe("chatContentText", () => {
  it("passes strings through and turns null into empty", () => {
    assert.equal(chatContentText("hi **there**"), "hi **there**");
    assert.equal(chatContentText(null), "");
    assert.equal(chatContentText(undefined), "");
  });

  it("flattens OpenAI-style content blocks — the [object Object] crash", () => {
    assert.equal(
      chatContentText([
        { type: "text", text: "CSE 100 runs every quarter." },
        { type: "reasoning", summary: [] },
        { type: "text", text: "Seats are open." },
      ]),
      "CSE 100 runs every quarter.\nSeats are open."
    );
  });

  it("never returns a non-string for an object", () => {
    assert.equal(chatContentText({ text: "plain" }), "plain");
    assert.equal(typeof chatContentText({ foo: 1 }), "string");
  });
});
