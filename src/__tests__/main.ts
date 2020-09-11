import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import { execSync } from 'child_process';
import { glob } from 'glob';
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
      args: `--inputFile './node_modules/maas-schemas-git-develop/maas-schemas/schemas/**/*.json' --outputDir ${tsDir} --base http://maasglobal.com/`.split(
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
    execSync(`npm install --no-save io-ts fp-ts`, {
      cwd: tmpDir,
    });
    const tsFiles = glob.sync(path.join(tsDir, '**', '*.ts'));
    const program = ts.createProgram(tsFiles, {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      lib: ['esnext', 'dom'],
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
    program.emit();
  });
});
