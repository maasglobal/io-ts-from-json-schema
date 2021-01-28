#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';
import * as stream from 'stream';
import * as yargs from 'yargs';

import { Args, iotsfjs } from './iotsfjs';

export const parser = (args: Array<string>) => {
  const { argv } = yargs(args)
    .option('inputFile', { type: 'string', demandOption: true })
    .option('outputDir', { type: 'string', demandOption: true })
    .option('strict', { type: 'boolean', default: false })
    .option('maskNull', { type: 'boolean', default: false })
    .option('emit', { type: 'boolean', default: true })
    .option('base', { type: 'string', default: '' })
    .option('import', { type: 'string', array: true, default: [] })
    .option('importHashAlgorithm', {
      type: 'string',
      default: 'sha256',
      choices: crypto.getHashes(),
      hidden: true,
    })
    .option('qed', {
      type: 'string',
      default: '.',
      hidden: true,
    })
    .option('importHashLength', {
      type: 'number',
      default: 0,
    })
    .help();
  return argv;
};

export const emit = (outputFile: string, lines: Generator<string, void, undefined>) => {
  function createParentDir(file: string) {
    const parentDir = path.dirname(file);
    if (fs.existsSync(parentDir)) {
      return;
    }
    createParentDir(parentDir);
    fs.mkdirSync(parentDir);
  }
  createParentDir(outputFile);

  const fd = fs.openSync(outputFile, 'w');
  fs.writeFileSync(fd, '');
  // eslint-disable-next-line fp/no-loops
  for (const line of lines) {
    fs.appendFileSync(fd, `${line}\n`);
  }
  fs.closeSync(fd);
};

type Streams = {
  stderr: stream.Writable;
  stdout: stream.Writable;
};

export const processFile = (
  argv: ReturnType<typeof parser>,
  { stderr, stdout }: Streams,
) => {
  const inputSchema = JSON.parse(fs.readFileSync(path.resolve(argv.inputFile), 'utf-8'));

  const [documentURI] = (
    inputSchema.$id ?? 'file://'.concat(path.resolve(argv.inputFile))
  ).split('#');

  if (documentURI.startsWith(argv.base) === false) {
    stderr.write(`Document URI ${documentURI} is outside of output base.\n`);
  }

  const args: Args = {
    ...argv,
    documentURI,
  };

  const relativeP = documentURI.slice(argv.base.length);
  const outputFile = path.join(argv.outputDir, relativeP.split('.json').join('.ts'));

  const outputData = iotsfjs(inputSchema, args, stderr);

  if (argv.emit) {
    emit(outputFile, outputData);
  }

  stdout.write(argv.qed);
};

type Process = Streams & {
  args: Array<string>;
};

export function main({ args, stderr, stdout }: Process) {
  const { inputFile: inputGlob, ...commonArgs } = parser(args);
  const schemaFiles = glob.sync(inputGlob);
  stdout.write(`Converting ${schemaFiles.length} schema files from ${inputGlob}.\n`);
  schemaFiles.sort().forEach((inputFile) => {
    try {
      processFile({ ...commonArgs, inputFile }, { stderr, stdout });
    } catch (e) {
      stderr.write(`iotsfjs crash while processing ${path.resolve(inputFile)}${'\n'}`);
      // eslint-disable-next-line fp/no-throw
      throw e;
    }
  });
}
