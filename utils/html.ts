import { globalStyles } from "utils/css.ts";
import { BASE_PATH } from "utils/consts.ts";

/**
 * Options for the {@link html} function.
 */
export interface HTMLOptions {
  /**
   * The title of the HTML document.
   */
  title: string;

  /**
   * The language of the HTML document.
   */
  language?: string;

  /**
   * The description of the HTML document.
   */
  description?: string;

  /**
   * The author of the HTML document.
   */
  author?: string;
}

/**
 * Generate a HTML document with the given body and options along with
 * injecting any global styles added to the {@link globalStyles} object.
 */
export function html(body: string, options: HTMLOptions) {
  options.language ??= "en";

  return `
    <!DOCTYPE html>
    <html lang="${options.language}">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="${BASE_PATH}/index.css" />
        <link rel="icon" href="${BASE_PATH}/favicon.svg" sizes="any" type="image/svg+xml">
        <link rel="alternate" type="application/rss+xml" href="/blog/feed.rss" title="Nova Blog (RSS)">
        <link rel="alternate" type="application/atom+xml" href="/blog/feed.atom" title="Nova Blog (Atom)">
        <link rel="alternate" type="application/feed+json" href="/blog/feed.json" title="Nova Blog (JSON)">
        <style>
          ${
    Object.values(globalStyles)
      .map(({ code }) => code)
      .join("\n\n")
  }
        </style>
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://trynova.dev/" />
        <meta property="og:title" content="${options.title}" />
        <meta property="og:description" content="${
    options.description ?? "JS engine lolz"
  }" />
        <meta name="description" content="${
    options.description ?? "JS engine lolz"
  }" />
        ${
    options.author ? `<meta name="author" content="${options.author}" />` : ""
  }
        <title>${options.title}</title>
      </head>
      <body class="root">
        ${body}
      </body>
    </html>
  `;
}
