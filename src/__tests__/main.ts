import { execSync } from 'child_process';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';
import { Writable } from 'stream';
import * as ts from 'typescript';

import { main } from '../main';

describe('main', () => {
  it('should convert maas-schemas', () => {
    const tmpRoot = 'tmp';
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'test-run-'));
    const tsDir = path.join(tmpDir, 'src');
    const jsDir = path.join(tmpDir, 'lib');
    const packageFile = path.join(tmpDir, 'package.json');

    const stderr = new Writable({
      write: (buffer, _encoding, cb) => {
        const msg = String(buffer);
        if (msg.includes('ERROR')) {
          throw new Error(msg);
        }
        cb();
      },
    });
    const stdout = new Writable({
      write: (_buffer, _encoding, cb) => {
        cb();
      },
    });

    main({
      stderr,
      stdout,
      args: `--inputFile './node_modules/maas-schemas-git-develop/maas-schemas/schemas/**/*.json' --outputDir ${tsDir} https://schemas.maas.global/ --maskNull`.split(
        ' ',
      ),
    });
    const fakePackage = {
      name: 'x',
      description: 'x',
      version: '0.0.1',
      license: 'UNLICENSED',
      repository: {},
    };
    execSync(`echo '${JSON.stringify(fakePackage)}' > ${packageFile}`);
    execSync(`npm install --no-save io-ts io-ts-types fp-ts monocle-ts newtype-ts`, {
      cwd: tmpDir,
    });
    const tsFiles = glob.sync(path.join(tsDir, '**', '*.ts'));
    const program = ts.createProgram(tsFiles, {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      typeRoots: ['./node_modules/@types'],
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      downlevelIteration: true,
      declaration: true,
      baseUrl: '.',
      outDir: jsDir,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const errors = Array.from(new Set(diagnostics.map(({ messageText }) => messageText)));
    expect(errors).toStrictEqual([]);
    program.emit();
    const tsSize = parseInt(
      execSync(`du -s ${tsDir} | cut -f1`, { encoding: 'ascii' }),
      10,
    );
    const jsSize = parseInt(
      execSync(`du -s ${jsDir} | cut -f1`, { encoding: 'ascii' }),
      10,
    );
    const ratio = jsSize / tsSize;
    const multiplier = 4;
    // detect exponential lib growth
    expect(ratio).toBeLessThan(multiplier);
  });
});
