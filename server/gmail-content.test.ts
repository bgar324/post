import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeEmailHtml } from "./gmail";

describe("Gmail message content", () => {
  it("preserves useful HTML structure while removing executable content", () => {
    const sanitized = sanitizeEmailHtml(
      '<p>Hello <strong>Ben</strong></p><script>alert(1)</script><a href="javascript:alert(2)">bad</a><img src="https://tracker.example/open/unique">',
    );

    expect(sanitized).toContain("<p>Hello <strong>Ben</strong></p>");
    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("tracker.example");
  });

  it("decodes entities and separates block and table content", () => {
    const text = htmlToText(
      "<p>I&#39;m here</p><table><tr><td>Account</td><td>Ben</td></tr></table>",
    );

    expect(text).toContain("I'm here");
    expect(text).toContain("Account\tBen");
  });
});
