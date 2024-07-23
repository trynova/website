import { renderToString } from "preact-render-to-string";

import { html } from "utils/html.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";
import { BlogPostCard } from "components/BlogPostCard.tsx";

import { posts } from "./utils.ts";
import { css } from "utils/css.ts";

const classes = await css(import.meta.resolve("./index.css"));

const allPosts = await Array.fromAsync(posts());

function Index() {
  return (
    <Layout>
      <h1>Blog</h1>
      <ul class={classes.list}>
        {allPosts
          .sort(({ meta: { date: a } }, { meta: { date: b } }) =>
            Temporal.PlainDate.compare(b, a)
          )
          .map((post) => <BlogPostCard {...post} />)}
      </ul>
    </Layout>
  );
}

if (import.meta.main) {
  await write(
    output(import.meta.url),
    html(renderToString(<Index />), { title: "Blog · Nova" }),
  );
}
