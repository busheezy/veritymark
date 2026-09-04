#!/usr/bin/env node

import { executeCli } from "./app.js";

const argv = process.argv.slice(2);

const exitCode = await executeCli(argv);

process.exitCode = exitCode;
