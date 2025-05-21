import { renderToString } from "preact-render-to-string";
import { Octokit } from "@octokit/core";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";
import { throttling } from "@octokit/plugin-throttling";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import type { EndpointDefaults } from "@octokit/types";

import { Chart } from "fresh_charts";

import { html } from "utils/html.ts";
import { css } from "utils/css.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";

const classes = await css(import.meta.resolve("./test262.css"));

export interface Commit {
  sha: string;
  message: string;
  date: Temporal.Instant;
  metrics: Metrics;
}

export interface Metrics {
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

function makeDataset(
  commits: Commit[],
  result: keyof Metrics["results"],
) {
  return {
    label: result[0].toUpperCase() + result.slice(1),
    data: commits.map(({ metrics: { total, results } }) =>
      results[result] / total * 100
    ),
    backgroundColor: `var(--chart-${result})`,
    borderColor: `var(--chart-${result})`,
    fill: "origin",
    pointStyle: false,
  };
}

async function* fetchMetrics(): AsyncGenerator<Commit> {
  const MyOctokit = Octokit.plugin(
    restEndpointMethods,
    paginateRest,
    throttling,
  );

  function rateLimitHandler(
    retryAfter: number,
    options: Required<EndpointDefaults>,
    octokit: Octokit,
    retryCount: number,
  ) {
    octokit.log.warn(
      `Request quota exhausted for request ${options.method} ${options.url}`,
    );
    octokit.log.info(
      `Retry count is ${retryCount}`,
    );

    if (retryCount < 3) {
      octokit.log.warn(`Retrying after ${retryAfter} seconds!`);
      return true;
    }
  }

  const octokit = new MyOctokit({
    auth: Deno.env.get("GITHUB_TOKEN"),
    throttle: {
      enabled: true,
      onRateLimit: rateLimitHandler,
      onSecondaryRateLimit: rateLimitHandler,
    },
  });

  for await (
    const { data: commits } of octokit.paginate.iterator(
      octokit.rest.repos.listCommits,
      {
        owner: "trynova",
        repo: "nova",
        path: "tests/metrics.json",
      },
    )
  ) {
    for (const commit of commits) {
      const response = await octokit.rest.repos.getContent({
        mediaType: {
          format: "raw",
        },
        owner: "trynova",
        repo: "nova",
        path: "tests/metrics.json",
        ref: commit.sha,
      });
      if (typeof response.data !== "string") continue;

      yield {
        sha: commit.sha,
        message: commit.commit.message,
        date: Temporal.Instant.from(commit.commit.author?.date),
        metrics: JSON.parse(response.data) as Metrics,
      };
    }
  }
}

function Test262({ commits }: { commits: Commit[] }) {
  const latest = commits.at(-1)!;

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
              position: "left",
            },
            y2: {
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
              position: "right",
            },
          },
        }}
        data={{
          labels: commits.map(({ sha }) => sha.slice(0, 7)),
          datasets: [
            makeDataset(commits, "pass"),
            makeDataset(commits, "skip"),
            makeDataset(commits, "timeout"),
            makeDataset(commits, "unresolved"),
            makeDataset(commits, "fail"),
            makeDataset(commits, "crash"),
          ],
        }}
      />
      <table class={classes.table}>
        <caption>
          <code>{latest.message}</code>
          <br />
          At {latest.date.toLocaleString("sv-SE")} commit{" "}
          <a href={`https://github.com/trynova/nova/commit/${latest.sha}`}>
            {latest.sha}
          </a>
        </caption>
        <tr>
          <th>Pass</th>
          <th>Skip</th>
          <th>Timeout</th>
          <th>Unresolved</th>
          <th>Fail</th>
          <th>Crash</th>
        </tr>
        <tr>
          <td>
            {latest.metrics.results.pass}{" "}
            ({((latest.metrics.results.pass / latest.metrics.total) * 100)
              .toFixed(1)}%)
          </td>
          <td>
            {latest.metrics.results.skip}{" "}
            ({((latest.metrics.results.skip / latest.metrics.total) * 100)
              .toFixed(1)}%)
          </td>
          <td>
            {latest.metrics.results.timeout}{" "}
            ({((latest.metrics.results.timeout / latest.metrics.total) * 100)
              .toFixed(1)}%)
          </td>
          <td>
            {latest.metrics.results.unresolved}{" "}
            ({((latest.metrics.results.unresolved / latest.metrics.total) * 100)
              .toFixed(1)}%)
          </td>
          <td>
            {latest.metrics.results.fail}{" "}
            ({((latest.metrics.results.fail / latest.metrics.total) * 100)
              .toFixed(1)}%)
          </td>
          <td>
            {latest.metrics.results.crash}{" "}
            ({((latest.metrics.results.crash / latest.metrics.total) * 100)
              .toFixed(1)}%)
          </td>
        </tr>
      </table>
      <p>
        A more detailed breakdown of the current test results can be viewed on
        {" "}
        <a href="https://test262.fyi/#|nova">test262.fyi</a>.
      </p>
    </Layout>
  );
}

if (import.meta.main) {
  const commits = (await Array.fromAsync(fetchMetrics()))
    .sort(({ date: a }, { date: b }) => Temporal.Instant.compare(a, b));

  // If we only have one commit, duplicate it to make the chart look better
  // this isn't an issue anymore since we have a lot of commits, but it was
  // a problem when we first started tracking test262 metrics.
  if (commits.length === 1) commits.push(commits[0]);

  await write(
    output(import.meta.url),
    html(renderToString(<Test262 commits={commits} />), {
      title: "Test262 · Nova",
      description:
        "The Nova engines current and historical Test262 test results",
      canonical: "/test262",
    }),
  );
}
