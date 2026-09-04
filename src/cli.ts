#!/usr/bin/env node

import { executeCli } from "./app.js";

process.exitCode = await executeCli(process.argv.slice(2));
