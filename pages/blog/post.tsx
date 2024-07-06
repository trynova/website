import { renderToString } from "preact-render-to-string";
import * as marked from "marked";

import { html } from "utils/html.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";
import { BlogPost, posts } from "./utils.ts";

function Post({ body }: BlogPost) {
  const html = marked.parse(body, { async: false }) as string;
  return <Layout dangerouslySetInnerHTML={{ __html: html }} />;
}

if (import.meta.main) {
  for await (const post of posts()) {
    await write(
      output(post.file),
      html(renderToString(<Post {...post} />), { title: "Nova" }),
    );
  }
}
