import { Marked } from "marked";
import markedFootnote from "marked-footnote";

import { css } from "utils/css.ts";
import clsx from "clsx";

const classes = await css(import.meta.resolve("./Markdown.css"));

export interface MarkdownProps {
  body: string;
  className?: string;
}

export function Markdown({ body, className }: MarkdownProps) {
  const html = new Marked()
    .use(markedFootnote())
    .parse(body, { async: false }) as string;

  return (
    <section
      class={clsx(classes.markdown, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
