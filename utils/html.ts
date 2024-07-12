import { globalStyles } from "utils/css.ts";
import { BASE_URL } from "utils/consts.ts";

export interface HTMLOptions {
  title: string;
  language?: string;
  description?: string;
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
        <link rel="stylesheet" href="${BASE_URL}/index.css" />
        <link rel="icon" href="${BASE_URL}/favicon.svg" sizes="any" type="image/svg+xml">
        <style>
          ${Object.values(globalStyles)
            .map(({ code }) => code)
            .join("\n\n")}
        </style>
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://trynova.dev/" />
        <meta property="og:title" content="${options.title}" />
        <meta property="og:description" content="${
          options.description ?? "JS engine lolz"
        }" />
        <meta property="description" content="${options.description ?? "JS engine lolz"}" />
        ${options.author ? `<meta name="author" content="${options.author}" />` : ""}
        <title>${options.title}</title>
      </head>
      <body class="root">
        ${body}
      </body>
    </html>
  `;
}
