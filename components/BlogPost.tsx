import { css } from "utils/css.ts";
import type { BlogPostMeta } from "../pages/blog/utils.ts";
import { Markdown } from "components/Markdown.tsx";

const classes = await css(import.meta.resolve("./BlogPost.css"));

export interface BlogPostProps {
  file: string;
  body: string;
  meta: BlogPostMeta;
}

export function BlogPost({ body, meta }: BlogPostProps) {
  return (
    <article class={classes.container}>
      <header>
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
              {" "}by {meta.authors.map((author, index) => (
                <>
                  <address>
                    <a href={author.url}>{author.name}</a>
                  </address>
                  {index < meta.authors.length - 1 ? ", " : ""}
                </>
              ))}
            </>
          )}
        </section>
      </header>
      <Markdown body={body} />
    </article>
  );
}
