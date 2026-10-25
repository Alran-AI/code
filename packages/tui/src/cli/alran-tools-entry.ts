#!/usr/bin/env node
import { configureAlranToolsChildEnvironment } from './alran-tools-environment.js';

configureAlranToolsChildEnvironment();
const embeddedEntry = new URL('./embedded/alran-tools/cli.mjs', import.meta.url);
await import(embeddedEntry.href);
