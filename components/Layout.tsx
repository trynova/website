import { JSX } from "preact";
import { clsx } from "clsx";

import { css } from "utils/css.ts";

import { Header } from "components/Header.tsx";
import { Footer } from "components/Footer.tsx";

const classes = await css(import.meta.resolve("./Layout.css"));

export function Layout(
  { children, class: className, ...props }: JSX.HTMLAttributes<HTMLElement>,
) {
  return (
    <>
      <Header />
      <main class={clsx(classes.main, className)} {...props}>{children}</main>
      <Footer />
    </>
  );
}
