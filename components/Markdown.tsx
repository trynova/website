import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import Prism from "prismjs";
import "prismjs/components/prism-bash.min.js";
import "prismjs/components/prism-javascript.min.js";
import "prismjs/components/prism-typescript.min.js";
import "prismjs/components/prism-css.min.js";
import "prismjs/components/prism-json.min.js";
import "prismjs/components/prism-jsx.min.js";
import "prismjs/components/prism-tsx.min.js";
import "prismjs/components/prism-rust.min.js";
import { css } from "utils/css.ts";
import clsx from "clsx";

const languageAliases: Record<string, string> = {
  rs: "rust",
  console: "sh",
};

const marked = new Marked(markedHighlight({
  emptyLangClass: "language-none",
  langPrefix: "language-",
  highlight(code, lang, _info) {
    lang = languageAliases[lang] ?? lang;
    const language = Prism.languages[lang] ?? Prism.languages.autoit;
    return Prism.highlight(code, language, lang);
  },
}));

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
