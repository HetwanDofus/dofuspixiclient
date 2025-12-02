#!/usr/bin/env bun

import { createProgram } from '@/console/extract-command.ts';

const program = createProgram();
program.parse(process.argv);

