import { renderToString } from "preact-render-to-string";
import { Octokit } from "octokit";

import { Chart } from "fresh_charts";

import { html } from "utils/html.ts";
import { css } from "utils/css.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";

const classes = await css(import.meta.resolve("./test262.css"));

const octokit = new Octokit();

const commits = await octokit.rest.repos.listCommits({
  owner: "trynova",
  repo: "nova",
  path: "tests/expectations.json",
});

const data = await Promise.all(commits.data.map(async (commit) => {
  const expectations = await (await fetch(
    `https://raw.githubusercontent.com/trynova/nova/${commit.sha}/tests/expectations.json`,
  )).json() as Record<string, "PASS" | "FAIL" | "CRASH" | "TIMEOUT">;
  const results = Object.values(expectations);
  return {
    sha: commit.sha,
    message: commit.commit.message,
    date: commit.commit.author?.date,
    expectations,
    metrics: {
      pass: results.filter((result) => result === "PASS").length,
      fail: results.filter((result) => result === "FAIL").length,
      crash: results.filter((result) => result === "CRASH").length,
      timeout: results.filter((result) => result === "TIMEOUT").length,
    },
  };
}));

function Test262() {
  return (
    <Layout>
      <h1>Test262</h1>
      <p>
        <a href="https://github.com/tc39/test262">Test262</a>{" "}
        is the official test suite of the ECMAScript specification. To ensure
        conformity with the specification and prevent regressions, we
        continuously test Nova against the test suite and track the results.
        Below is a chart showing the test results of the latest commits to Nova.
      </p>
      <Chart
        type="line"
        svgClass={classes.chart}
        options={{
          scales: {
            x: {
              grid: {
                color: "var(--neutral-400)",
              },
            },
            y: {
              grid: {
                color: "var(--neutral-400)",
              },
            },
          },
        }}
        data={{
          labels: data.map(({ sha }) => sha.slice(0, 7)),
          datasets: [
            // {
            //   label: "Pass",
            //   data: data.map(({ metrics }) => metrics.pass),
            //   borderColor: "var(--success)",
            //   pointStyle: false,
            // },
            {
              label: "Fail",
              data: data.map(({ metrics }) => metrics.fail),
              borderColor: "var(--error)",
              pointStyle: false,
            },
            {
              label: "Crash",
              data: data.map(({ metrics }) => metrics.crash),
              borderColor: "var(--error)",
              pointStyle: false,
            },
            {
              label: "Timeout",
              data: data.map(({ metrics }) => metrics.timeout),
              borderColor: "var(--warning)",
              pointStyle: false,
            },
          ],
        }}
      />
      <p>
        A more detailed breakdown of the current test results can be viewed on
        {" "}
        <a href="https://test262.fyi/#|nova">test262.fyi</a>.
      </p>
    </Layout>
  );
}

if (import.meta.main) {
  await write(
    output(import.meta.url),
    html(renderToString(<Test262 />), { title: "Test262 · Nova" }),
  );

  // HACK: Exit process to prevent hanging. There is a bug loose in the code
  // preventing the process from exiting. Probably a promise that is not being
  // awaited or octokit which needs to be closed somehow.
  Deno.exit();
}
