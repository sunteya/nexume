import { describe, expect, test } from "bun:test"
import type { WindowLike } from "dompurify"
import { JSDOM } from "jsdom"

import { createMarkdownRenderer } from "./markdown"

const renderMarkdown = createMarkdownRenderer(
  new JSDOM("").window as unknown as WindowLike,
)

describe("renderMarkdown", () => {
  test("renders Markdown and preserves conversational line breaks", () => {
    const html = renderMarkdown(`# Heading

**Bold** and [docs](https://example.com)
next line

- first
- second

\`\`\`ts
const value = true
\`\`\``)

    expect(html).toContain("<h1>Heading</h1>")
    expect(html).toContain("<strong>Bold</strong>")
    expect(html).toContain('<a href="https://example.com">docs</a><br>')
    expect(html).toContain("<ul>")
    expect(html).toContain('<code class="language-ts">')
  })

  test("keeps allowed inline HTML and removes presentation attributes", () => {
    const html = renderMarkdown(
      '<details open><summary>More</summary><mark>note</mark><span title="safe" style="position:fixed">text</span></details>',
    )

    expect(html).toContain('<details open=""><summary>More</summary>')
    expect(html).toContain("<mark>note</mark>")
    expect(html).toContain('<span title="safe">text</span>')
    expect(html).not.toContain("style=")
  })

  test("renders pty exit events as escaped code blocks", () => {
    const html = renderMarkdown(`Before

<pty_exited>
ID: pty_123
Exit Code: 0
Output: **complete** <img src=x onerror=alert(1)>
</pty_exited>

After`)

    expect(html).toContain(
      '<div class="session-event-block"><span class="session-event-block-label">pty_exited</span><pre class="session-pty-exited"><code>',
    )
    expect(html).toContain("ID: pty_123\nExit Code: 0\n")
    expect(html).toContain(
      "Output: **complete** &lt;img src=x onerror=alert(1)&gt;",
    )
    expect(html).not.toContain("<strong>complete</strong>")
    expect(html).not.toContain("<img src=\"x\"")
  })

  test("removes executable HTML and unsafe URLs", () => {
    const html = renderMarkdown(`
<script>alert("xss")</script>
<iframe src="https://example.com"></iframe>
<img src="image.png" onerror="alert(1)">
<a href="javascript:alert(1)" onclick="alert(1)">unsafe</a>
<a href="/sessions/1">relative</a>
<a href="mailto:user@example.com">email</a>
`)

    expect(html).not.toContain("<script")
    expect(html).not.toContain("<iframe")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("onclick")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('<img src="image.png">')
    expect(html).toContain('<a href="/sessions/1">relative</a>')
    expect(html).toContain('<a href="mailto:user@example.com">email</a>')
  })
})
