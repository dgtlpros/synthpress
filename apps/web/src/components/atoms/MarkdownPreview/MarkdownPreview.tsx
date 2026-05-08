import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

/**
 * Renders Markdown as styled HTML.
 *
 * Why hand-styled component overrides instead of `@tailwindcss/typography`:
 *   * Avoids adding another Tailwind plugin to the project for one
 *     surface that needs ~10 element types.
 *   * Keeps every link rendered with the brand colour + the safe
 *     `target="_blank" rel="noopener noreferrer"` triple — easier to
 *     audit than overriding a typography preset.
 *
 * `remark-gfm` adds GitHub-flavoured Markdown support (tables, task
 * lists, strikethrough, autolinks) which is what Claude tends to
 * produce for article bodies.
 */

export interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
}

export function MarkdownPreview({ markdown, className }: MarkdownPreviewProps) {
  return (
    <div className={cn("text-sm text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 text-2xl font-bold text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 mb-2 text-xl font-semibold text-foreground first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-2 text-lg font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-3 leading-relaxed text-foreground first:mt-0 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-6 marker:text-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-blue underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-4 text-muted italic">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName }) => {
            const isBlock = Boolean(codeClassName);
            return isBlock ? (
              <code
                className={cn(
                  "block whitespace-pre-wrap font-mono text-xs",
                  codeClassName,
                )}
              >
                {children}
              </code>
            ) : (
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-[var(--sp-radius-md)] bg-surface-hover p-3">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-6 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-surface-hover px-3 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-2">{children}</td>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element -- markdown images come from arbitrary external sources, next/image's domain allowlist would block them
            <img
              src={src as string}
              /* v8 ignore next -- react-markdown always passes a string alt (empty when omitted), so the ?? "" fallback is unreachable from real input */
              alt={alt ?? ""}
              className="my-3 max-w-full rounded-[var(--sp-radius-md)]"
            />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
