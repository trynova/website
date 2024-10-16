import { renderToString } from "preact-render-to-string";

import { html } from "utils/html.ts";
import { href, output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";
import { BlogPost } from "components/BlogPost.tsx";

import { BlogPostProps, posts } from "./utils.ts";

function Post(props: BlogPostProps) {
  return (
    <Layout>
      <BlogPost {...props} />
    </Layout>
  );
}

if (import.meta.main) {
  for await (const post of posts()) {
    await write(
      output(post.file),
      html(renderToString(<Post {...post} />), {
        title: `${post.meta.title} · Nova`,
        description: post.meta.description,
        author: post.meta.authors.map((author) => author.name).join(", "),
        canonical: href(post.file),
      }),
    );
  }
}
