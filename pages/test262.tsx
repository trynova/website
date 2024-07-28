import { renderToString } from "preact-render-to-string";
import { Octokit } from "octokit";

import { Chart } from "fresh_charts";

import { html } from "utils/html.ts";
import { css } from "utils/css.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";

const classes = await css(import.meta.resolve("./test262.css"));

interface Metrics {
  results: {
    crash: number;
    fail: number;
    pass: number;
    skip: number;
    timeout: number;
    unresolved: number;
  };
  total: number;
}

function dataset(datapoints: typeof data, result: keyof Metrics["results"]) {
  return {
    label: result[0].toUpperCase() + result.slice(1),
    data: datapoints.map(({ metrics: { total, results } }) =>
      results[result] / total * 100
    ),
    backgroundColor: `var(--chart-${result})`,
    borderColor: `var(--chart-${result})`,
    fill: "origin",
    pointStyle: false,
  };
}

const octokit = new Octokit({
  auth: "130142cd1b8189111d726b4691d9b0fd43d9da0f",
});
const commits = await octokit.rest.repos.listCommits({
  owner: "trynova",
  repo: "nova",
  path: "tests/metrics.json",
  per_page: 100,
});

const data = (await Promise.all(commits.data.map(async (commit) => {
  const metrics = await (await fetch(
    `https://raw.githubusercontent.com/trynova/nova/${commit.sha}/tests/metrics.json`,
  )).json() as Metrics;
  return {
    sha: commit.sha,
    message: commit.commit.message,
    date: Temporal.Instant.from(commit.commit.author?.date),
    metrics,
  };
}))).sort(({ date: a }, { date: b }) => Temporal.Instant.compare(a, b));

if (data.length === 1) data.push(data[0]);

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
          plugins: {
            filler: {
              propagate: false,
            },
            legend: {
              labels: {
                color: "var(--neutral-800)",
                font: {
                  family: "var(--font-mono)",
                  size: 10,
                },
                padding: 16,
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: "var(--neutral-800)",
                font: {
                  family: "var(--font-mono)",
                  size: 10,
                },
              },
              grid: {
                color: "var(--neutral-400)",
              },
            },
            y: {
              stacked: true,
              min: 0,
              max: 100,
              ticks: {
                color: "var(--neutral-800)",
                font: {
                  family: "var(--font-mono)",
                  size: 10,
                },
              },
              grid: {
                color: "var(--neutral-400)",
              },
            },
          },
        }}
        data={{
          labels: data.map(({ sha }) => sha.slice(0, 7)),
          datasets: [
            dataset(data, "pass"),
            dataset(data, "skip"),
            dataset(data, "timeout"),
            dataset(data, "unresolved"),
            dataset(data, "fail"),
            dataset(data, "crash"),
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
}
