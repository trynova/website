import { renderToString } from "preact-render-to-string";

import { html } from "utils/html.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";
import { Markdown } from "components/Markdown.tsx";

const body = await (await fetch(
  "https://github.com/trynova/nova/raw/refs/heads/main/CONTRIBUTING.md",
)).text();

function Contributing() {
  return (
    <Layout>
      <Markdown body={body} />
    </Layout>
  );
}

if (import.meta.main) {
  await write(
    output(import.meta.url),
    html(renderToString(<Contributing />), {
      title: `Contributing · Nova`,
      description: "Guide for contributing to the Nova project",
    }),
  );
}
