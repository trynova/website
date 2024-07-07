import * as marked from "marked";

import { css } from "utils/css.ts";

import { BlogPostProps } from "../pages/blog/utils.ts";

const classes = await css(import.meta.resolve("./BlogPost.css"));

export function BlogPost({ body, meta }: BlogPostProps) {
  const html = marked.parse(body, { async: false }) as string;

  return (
    <article class={classes.container}>
      <header class={classes.header}>
        <h1>
          {meta.title}
        </h1>
        <section class={classes.meta}>
          Published{" "}
          <time datetime={meta.date.toString()}>
            {meta.date.toLocaleString("sv-SE")}
          </time>
          {meta.authors.length >= 1 && (
            <>
              {" "}by{" "}
              {meta.authors.map((author) => (
                <address class={classes.author}>
                  <a href={author.url}>{author.name}</a>
                </address>
              ))}
            </>
          )}
        </section>
      </header>
      <section
        class={classes.body}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
