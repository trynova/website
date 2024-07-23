import { renderToString } from "preact-render-to-string";
import { Feed } from "feed";
import * as marked from "marked";

import { html } from "utils/html.ts";
import { output, href } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";
import { BlogPostCard } from "components/BlogPostCard.tsx";

import { posts } from "./utils.ts";
import { css } from "utils/css.ts";

const classes = await css(import.meta.resolve("./index.css"));

const allPosts = (await Array.fromAsync(posts()))
  .sort(({ meta: { date: a } }, { meta: { date: b } }) =>
    Temporal.PlainDate.compare(b, a)
  );

function Index() {
  return (
    <Layout>
      <h1>Blog</h1>
      <ul class={classes.list}>
        {allPosts
          .map((post) => <BlogPostCard {...post} />)}
      </ul>
    </Layout>
  );
}

if (import.meta.main) {
  await write(
    output(import.meta.url),
    html(renderToString(<Index />), { title: "Blog ▲ Nova" }),
  );

  const feed = new Feed({
    title: "Nova Blog",
    description: "Nova Blog",
    id: "https://trynova.dev/blog",
    link: "https://trynova.dev/blog",
    language: "en",
    favicon: "https://trynova.dev/favicon.svg",
    copyright: `Copyleft ${new Date().getFullYear()} The Nova Contributors`,
  });

  allPosts
    .forEach((post) => {
      // BASE_URL doesn't seem to be defined, even in the prodution build, so `href` sometimes just returns a path, so we have to handle that case
      const possiblyPath = href(post.file);
      const link = possiblyPath.startsWith('https://') ? possiblyPath : `https://trynova.dev${possiblyPath}`;

      feed.addItem({
        title: post.meta.title,
        id: link,
        link,
        description: post.meta.description,
        content: marked.parse(post.body, { async: false }) as string,
        author: post.meta.authors.map((author) => ({
          name: author.name,
          link: author.url
        })),
        date: new Date(
          post.meta.date.toZonedDateTime('Etc/Greenwich').epochMilliseconds
        ),
      });
    });

  await write(output(import.meta.resolve('./feed.rss')), feed.rss2());
  await write(output(import.meta.resolve('./feed.atom')), feed.atom1());
  await write(output(import.meta.resolve('./feed.json')), feed.json1());
}
