#!/bin/sh
cd "$(dirname "$0")"
deno run --allow-net --allow-read backend.ts
