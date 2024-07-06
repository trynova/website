import { css } from "utils/css.ts";

import { Logo } from "components/icons/Logo.tsx";

const classes = await css(import.meta.resolve("./Header.css"));

export function Header() {
  return (
    <header class={classes.header}>
      <a class={classes.logo} href="/">
        <Logo />
        <h1>Nova</h1>
      </a>
      <nav class={classes.navigation}>
        <a href="/talks">Talks</a>
        <a href="/blog">Blog</a>
        <a href="/contribute">Contribute</a>
      </nav>
    </header>
  );
}
