#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import * as yargs from 'yargs';
import { glob } from 'glob';

import { iotsfjs, Args } from './iotsfjs';

export const parser = (args: Array<string>) =>
  yargs(args)
    .option('inputFile', { type: 'string', demandOption: true })
    .option('outputDir', { type: 'string', demandOption: true })
    .option('strict', { type: 'boolean', default: false })
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
    .help().argv;

export const processFile = (argv: ReturnType<typeof parser>, proc: typeof process) => {
  const inputSchema = JSON.parse(fs.readFileSync(path.resolve(argv.inputFile), 'utf-8'));

  const [documentURI] = (
    inputSchema.$id ?? 'file://'.concat(path.resolve(argv.inputFile))
  ).split('#');

  if (documentURI.startsWith(argv.base) === false) {
    proc.stderr.write(`Document URI ${documentURI} is outside of output base.\n`);
  }

  const args: Args = {
    ...argv,
    documentURI,
  };

  const relativeP = documentURI.slice(argv.base.length);
  const outputFile = path.join(argv.outputDir, relativeP.split('.json').join('.ts'));

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
  // eslint-disable-next-line
for (const line of iotsfjs(inputSchema, args)) {
    fs.appendFileSync(fd, `${line}\n`);
  }
  fs.closeSync(fd);

  proc.stdout.write(argv.qed);
};

function main(proc: typeof process) {
  const { inputFile: inputGlob, ...argv } = parser(proc.argv.slice(2));
  const schemaFiles = glob.sync(inputGlob);
  proc.stdout.write(`Converting ${schemaFiles.length} schema files from ${inputGlob}.\n`);
  schemaFiles.sort().forEach((inputFile) => processFile({ ...argv, inputFile }, proc));
}

main(process);
