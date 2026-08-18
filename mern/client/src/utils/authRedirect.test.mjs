import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { oauthRedirectTo } from "./authRedirect.js";

describe("oauthRedirectTo", () => {
  it("returns the current origin and path so any local port matches", () => {
    assert.equal(
      oauthRedirectTo({ origin: "http://127.0.0.1:5174", pathname: "/" }),
      "http://127.0.0.1:5174/"
    );
    assert.equal(
      oauthRedirectTo({ origin: "http://localhost:5173", pathname: "/" }),
      "http://localhost:5173/"
    );
    assert.equal(
      oauthRedirectTo({ origin: "https://www.tritonplanner.com", pathname: "/" }),
      "https://www.tritonplanner.com/"
    );
  });

  it("keeps a non-root path", () => {
    assert.equal(
      oauthRedirectTo({ origin: "http://localhost:5173", pathname: "/planner" }),
      "http://localhost:5173/planner"
    );
  });
});
