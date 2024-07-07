import { css } from "utils/css.ts";
import { BlogPostProps } from "../pages/blog/utils.ts";
import { href } from "utils/path.ts";

const classes = await css(import.meta.resolve("./BlogPostCard.css"));

export function BlogPostCard({ file, meta }: BlogPostProps) {
  return (
    <li class={classes.container}>
      <a class={classes.link} href={href(file)}>
        <header class={classes.header}>
          <h2>{meta.title}</h2>
          <time datetime={meta.date.toString()}>
            {meta.date.toLocaleString("sv-SE")}
          </time>
        </header>
        <p>{meta.description}</p>
      </a>
    </li>
  );
}
