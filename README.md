# The Nova Website

This repo contains the source code for the Nova engines website.

## Development

The website is a static website using preact and a next-to-nothing build system
consisting of a small entrypoint in each page and the `deno task build` command
which runs them all. Development is done using the `deno task serve` command
which simply sets the `--watch` flag the script.
