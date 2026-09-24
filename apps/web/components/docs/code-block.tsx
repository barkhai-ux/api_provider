import { highlight, type CodeLanguage } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import { CodeTabsClient } from "./code-tabs-client";
import { CopyButton } from "./copy-button";

const codeSurface =
  "overflow-x-auto bg-code p-4 font-mono text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:outline-none";

/** A highlighted code sample (rendered on the server). */
export async function CodeBlock({
  code,
  lang,
  title,
  className,
}: {
  code: string;
  lang: CodeLanguage;
  title?: string;
  className?: string;
}) {
  const html = await highlight(code, lang);
  return (
    <figure className={cn("not-prose my-4 overflow-hidden rounded-lg border", className)}>
      <figcaption className="flex h-10 items-center justify-between border-b bg-muted/40 pr-1.5 pl-4 text-xs text-muted-foreground">
        <span className="font-mono">{title ?? lang}</span>
        <CopyButton text={code} />
      </figcaption>
      <div className={codeSurface} dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}

export type CodeExample = { label: string; lang: CodeLanguage; code: string };

/** The same example in several languages, with tabs. */
export async function CodeTabs({ examples, className }: { examples: CodeExample[]; className?: string }) {
  const rendered = await Promise.all(
    examples.map(async (example) => ({ ...example, html: await highlight(example.code, example.lang) })),
  );
  return <CodeTabsClient items={rendered} className={className} surfaceClassName={codeSurface} />;
}
