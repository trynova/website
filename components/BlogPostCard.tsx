import { css } from "utils/css.ts";
import { BlogPostProps } from "../pages/blog/utils.ts";
import { href } from "utils/path.ts";

const classes = await css(import.meta.resolve("./BlogPostCard.css"));

export function BlogPostCard({ file, meta }: BlogPostProps) {
  return (
    <li class={classes.container}>
      <a class={classes.link} href={href(file)}>
        <header>
          <h2 class={classes.title}>
            {meta.title}
          </h2>
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
                      {author.name}
                    </address>
                    {index < meta.authors.length - 1 ? ", " : ""}
                  </>
                ))}
              </>
            )}
          </section>
        </header>

        <p>{meta.description}</p>
      </a>
    </li>
  );
}
