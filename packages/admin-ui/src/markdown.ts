import DOMPurify, { type Config, type WindowLike } from "dompurify"
import MarkdownIt from "markdown-it"

const markdown = new MarkdownIt({
  breaks: true,
  html: true,
  linkify: true,
})

const ptyExitedPattern = /<pty_exited>\s*([\s\S]*?)\s*<\/pty_exited>/gi

const sanitizeConfig: Config = {
  ALLOWED_ATTR: [
    "alt",
    "class",
    "colspan",
    "href",
    "open",
    "rel",
    "rowspan",
    "src",
    "title",
  ],
  ALLOWED_TAGS: [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "details",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
}

export function createMarkdownRenderer(
  root: WindowLike,
): (text: string) => string {
  const purifier = DOMPurify(root)
  return (text) => {
    const normalized = text.replace(ptyExitedPattern, (_match, content: string) =>
      `\n\n<div class="session-event-block"><span class="session-event-block-label">pty_exited</span><pre class="session-pty-exited"><code>${markdown.utils.escapeHtml(content.trim())}</code></pre></div>\n\n`,
    )
    return purifier.sanitize(markdown.render(normalized), sanitizeConfig)
  }
}

let browserRenderer: ((text: string) => string) | undefined

export function renderMarkdown(text: string): string {
  browserRenderer ??= createMarkdownRenderer(window)
  return browserRenderer(text)
}
