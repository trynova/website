import { renderToString } from "preact-render-to-string";

import { html } from "utils/html.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";

function Index() {
  return (
    <Layout>
      Hello, World!
    </Layout>
  );
}

if (import.meta.main) {
  await write(
    output(import.meta.url),
    html(renderToString(<Index />), { title: "Nova" }),
  );
}
