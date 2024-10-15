import * as marked from "marked";

import { css } from "utils/css.ts";
import clsx from "clsx";

const classes = await css(import.meta.resolve("./Markdown.css"));

export interface MarkdownProps {
  body: string;
  className?: string;
}

export function Markdown({ body, className }: MarkdownProps) {
  const html = marked.parse(body, { async: false }) as string;

  return (
    <section
      class={clsx(classes.markdown, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
