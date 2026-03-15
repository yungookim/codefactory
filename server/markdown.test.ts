import test from "node:test";
import assert from "node:assert/strict";
import { renderGitHubMarkdown } from "./markdown";

test("renderGitHubMarkdown preserves markdown structure and strips unsafe html", () => {
  const html = renderGitHubMarkdown("**bold**\n\n```js\nconsole.log(1)\n```\n<script>alert(1)</script>");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.doesNotMatch(html, /<script>/);
});
