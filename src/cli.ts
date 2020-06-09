#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as gen from 'io-ts-codegen';
import { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import * as yargs from 'yargs';

/* eslint-disable @typescript-eslint/no-use-before-define */

const { argv } = yargs
  .option('inputFile', { type: 'string', demandOption: true })
  .option('outputDir', { type: 'string', demandOption: true })
  .option('strict', { type: 'boolean' })
  .option('base', { type: 'string', default: '' })
  .option('import', { type: 'string', array: true, default: [] })
  .help();

type URI = string;
type Location = string;
const imports: Array<[URI, Location]> = argv.import.map(
  (imp: string) => imp.split('^') as [URI, Location],
);

// START: Ajv Schema Helpers https://github.com/epoberezkin/ajv-keywords

type AjvKeywordsRegexpString = string;
type AjvKeywordsRegexpObject = {
  pattern: string;
  flags: string;
};
type AjvKeywordsRegexp = AjvKeywordsRegexpString | AjvKeywordsRegexpObject;

type AjvKeywords = { regexp: AjvKeywordsRegexp };

type AjvSchema = JSONSchema7 & AjvKeywords;

function isRegexpString(regexp: AjvKeywordsRegexp): regexp is AjvKeywordsRegexpString {
  return typeof regexp === 'string';
}

function isRegexpObject(regexp: AjvKeywordsRegexp): regexp is AjvKeywordsRegexpObject {
  return typeof regexp === 'object';
}

function regexpObjectFromString(
  regexp: AjvKeywordsRegexpString,
): AjvKeywordsRegexpObject {
  const pattern = regexp.split('/').slice(1, -1).join('/');
  const [flags] = regexp.split('/').slice(-1);
  return { pattern, flags };
}

function getRegexpObject(regexp: AjvKeywordsRegexp): AjvKeywordsRegexpObject {
  if (isRegexpString(regexp)) {
    return regexpObjectFromString(regexp);
  }
  if (isRegexpObject(regexp)) {
    return regexp;
  }
  // eslint-disable-next-line
  throw new Error("unknown regexp format");
}

// END: Ajv Schema Helpers

function capitalize(word: string) {
  const empty: '' = '';
  const [c, ...cs] = word.split(empty);
  return [c.toUpperCase(), ...cs].join(empty);
}

// ALL_UPPER-CASE => ALL_UPPERCASE
function typenameFromAllCaps(allCaps: string): string {
  return allCaps.split('-').join('');
}

// random-caseCombination => RandomCaseCombination
function typenameFromKebab(kebab: string): string {
  const typename = kebab.split('-').map(capitalize).join('');
  return typename;
}

function isAllCaps(randomCase: string): boolean {
  return randomCase === randomCase.toUpperCase();
}

function typenameFromRandom(randomCase: string): string {
  if (isAllCaps(randomCase)) {
    return typenameFromAllCaps(randomCase);
  }
  return typenameFromKebab(randomCase);
}

function getDefaultExport(jsonFilePath: string) {
  const [withoutPath] = jsonFilePath.split('/').slice(-1);
  const [withouExtension] = withoutPath.split('.json');
  return typenameFromRandom(withouExtension);
}

const createHelper = (d: gen.TypeDeclaration) =>
  `\n${gen.printStatic(d)}\n${gen.printRuntime(d)}\n`;

const definedHelper = createHelper(
  gen.typeDeclaration(
    'Defined',
    gen.unionCombinator([
      gen.unknownRecordType,
      gen.unknownArrayType,
      gen.stringType,
      gen.booleanType,
      gen.numberType,
      gen.nullType,
    ]),
  ),
);
const Defined = gen.customCombinator('Defined', 'Defined');

const supportedEverywhere = [
  '$ref',
  '$id',
  'title',
  'description',
  'definitions',
  'type',
  'properties',
  'patternProperties',
  'required',
  'additionalProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'enum',
  'const',
  'items',
  'contains',
  'additionalItems',
];
const supportedAtRoot = [
  'minimum',
  'maximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'regexp',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
  'examples',
];

const inputSchema: JSONSchema7 = JSON.parse(
  fs.readFileSync(path.resolve(argv.inputFile), 'utf-8'),
);

const [documentURI] = (
  inputSchema.$id ?? 'file://'.concat(path.resolve(argv.inputFile))
).split('#');

if (documentURI.startsWith(argv.base) === false) {
  error(`Document URI ${documentURI} is outside of output base.`);
}

const documentBase = (() => {
  // eslint-disable-next-line
  const [, ...reversePath] = documentURI.split('/').reverse();
  // eslint-disable-next-line
  return reversePath.reverse().join('/');
})();

const relativeP = documentURI.slice(argv.base.length);

const defaultExport = getDefaultExport(argv.inputFile);
const outputFile = path.join(argv.outputDir, relativeP.split('.json').join('.ts'));

const imps = new Set<string>();
const helpers = new Set<string>();
const exps = new Set<string>();

enum ErrorCode {
  WARNING = 1,
  ERROR = 2,
}
type OK = 0;
const OK: OK = 0;
type ReturnCode = OK | ErrorCode;
// eslint-disable-next-line
let returnCode: ReturnCode = OK;

function updateFailure(level: ErrorCode) {
  if (returnCode === ErrorCode.ERROR) {
    return;
  }
  // eslint-disable-next-line
  returnCode = level;
}

function reportError(level: 'INFO' | 'WARNING' | 'ERROR', message: string) {
  const lines = [`${level}: ${message}`, `  in ${argv.inputFile}`];
  // eslint-disable-next-line
  console.error(lines.join("\n"));
}

function error(message: string) {
  updateFailure(ErrorCode.ERROR);
  reportError('ERROR', message);
  const escalate = "throw new Error('schema conversion failed')";
  return gen.customCombinator(escalate, escalate);
}
function warning(message: string) {
  updateFailure(ErrorCode.WARNING);
  reportError('WARNING', message);
}
function info(message: string) {
  reportError('INFO', message);
}

function notImplemented(pre: string, item: string, post: string, fatal = false) {
  const isOutsideRoot = supportedAtRoot.includes(item);
  const where = isOutsideRoot ? 'outside top-level definitions' : '';
  const message = [pre, item, post, 'not supported', where]
    .filter((s) => s.length > 0)
    .join(' ');

  if (fatal !== true && isOutsideRoot) {
    warning(message);
    return null;
  }
  return error(message);
}

function parseRef(ref: string) {
  const parts = ref.split('#');
  if (parts.length === 1) {
    const [filePath] = parts;
    return { filePath, variableName: getDefaultExport(filePath) };
  }
  if (parts.length > 2) {
    // eslint-disable-next-line
    throw new Error("unknown ref format");
  }
  const [filePath, jsonPath] = parts;
  // eslint-disable-next-line
  const jsonPathParts = jsonPath.split("/");
  if (jsonPathParts.length !== 3) {
    // eslint-disable-next-line
    throw new Error("unknown ref format");
  }
  const [empty, definitions, name] = jsonPathParts;
  if (empty !== '') {
    // eslint-disable-next-line
    throw new Error("unknown ref format");
  }
  if (definitions !== 'definitions') {
    // eslint-disable-next-line
    throw new Error("unknown ref format");
  }
  const variableName = typenameFromKebab(name);
  return { filePath, variableName };
}

function fromPatternProperties(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('patternProperties' in schema && typeof schema.patternProperties !== 'undefined') {
    // the mapping from pattern to item is lost in the process
    // See https://github.com/microsoft/TypeScript/issues/6579
    warning('patternProperty support has limitations');

    type Pattern = string;

    // The Record must also support non-pattern properties
    const exactPairs = Object.entries(
      schema.properties ?? {},
    ).map(<V>([key, value]: [string, V]): [Pattern, V] => [`^${key}$`, value]);
    const fuzzyPairs = Object.entries(schema.patternProperties);
    const allPairs = exactPairs.concat(fuzzyPairs);
    const valueCombinators = allPairs.map(<K extends string, V>([_key, value]: [K, V]) =>
      fromSchema(value),
    );

    const valueCombinator = (() => {
      if (valueCombinators.length > 1) {
        return gen.unionCombinator(valueCombinators);
      }
      const [combinator] = valueCombinators;
      return combinator;
    })();

    return [gen.recordCombinator(gen.stringType, valueCombinator)];
  }
  return [];
}

function fromProperties(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('properties' in schema && typeof schema.properties !== 'undefined') {
    const combinator = gen.partialCombinator(
      Object.entries(schema.properties).map(<K extends string, V>([key, value]: [K, V]) =>
        gen.property(key, fromSchema(value)),
      ),
    );
    return [combinator];
  }
  return [];
}

function toInterfaceCombinator(schema: JSONSchema7): gen.TypeReference {
  const combinators = [...fromProperties(schema), ...fromPatternProperties(schema)];
  const combinator = (() => {
    if (combinators.length > 1) {
      return gen.intersectionCombinator(combinators);
    }
    if (combinators.length === 1) {
      const [combinator] = combinators;
      return combinator;
    }
    return gen.interfaceCombinator([]);
  })();

  if (schema.hasOwnProperty('additionalproperties') === false) {
    return combinator;
  }
  if (typeof schema.additionalProperties !== 'boolean') {
    const escalate = notImplemented('specific', 'additionalProperties', 'schema', true);
    if (escalate !== null) {
      return escalate;
    }
  }
  if (schema.additionalProperties === false) {
    return gen.exactCombinator(combinator);
  }
  return combinator;
}

function toArrayCombinator(schema: JSONSchema7): gen.TypeReference {
  if (
    'items' in schema &&
    typeof schema.items !== 'undefined' &&
    typeof schema.items !== 'boolean'
  ) {
    if (schema.items instanceof Array) {
      if ('additionalItems' in schema && schema.additionalItems === false) {
        const combinators = schema.items.map((s) => fromSchema(s));
        return gen.tupleCombinator(combinators);
      }
      // eslint-disable-next-line
      throw new Error(
        "tuples with ...rest are not supported, set additionalItems false"
      );
    }
    return gen.arrayCombinator(fromSchema(schema.items));
  }
  return gen.unknownArrayType;
}

function checkPattern(x: string, pattern: string): string {
  const stringLiteral = JSON.stringify(pattern);
  return `( typeof x !== 'string' || ${x}.match(RegExp(${stringLiteral})) !== null )`;
}

function checkRegexp(x: string, regexp: AjvKeywordsRegexp): string {
  const { pattern, flags } = getRegexpObject(regexp);
  const patternLiteral = JSON.stringify(pattern);
  const flagsLiteral = JSON.stringify(flags);
  return `( typeof x !== 'string' || ${x}.match(RegExp(${patternLiteral}, ${flagsLiteral})) !== null )`;
}

function checkMinLength(x: string, minLength: number): string {
  return `( typeof x !== 'string' || ${x}.length >= ${minLength} )`;
}

function checkMaxLength(x: string, maxLength: number): string {
  return `( typeof x !== 'string' || ${x}.length <= ${maxLength} )`;
}

function checkMinimum(x: string, minimum: number): string {
  return `( typeof x !== 'number' || ${x} >= ${minimum} )`;
}

function checkMaximum(x: string, maximum: number): string {
  return `( typeof x !== 'number' || ${x} <= ${maximum} )`;
}

function checkMultipleOf(x: string, divisor: number): string {
  return `( typeof x !== 'number' || ${x} % ${divisor} === 0 )`;
}

function checkInteger(x: string): string {
  return `( Number.isInteger(${x}) )`;
}

function checkMinItems(x: string, minItems: number): string {
  return `( Array.isArray(x) === false || ${x}.length >= ${minItems} )`;
}

function checkMaxItems(x: string, maxItems: number): string {
  return `( Array.isArray(x) === false || ${x}.length <= ${maxItems} )`;
}

function checkUniqueItems(x: string): string {
  return `( Array.isArray(x) === false || ${x}.length === [...new Set(x)].length )`;
}

function generateChecks(x: string, schema: JSONSchema7): string {
  const checks: Array<string> = [
    ...(schema.pattern ? [checkPattern(x, schema.pattern)] : []),
    ...((schema as AjvSchema).regexp
      ? [checkRegexp(x, (schema as AjvSchema).regexp)]
      : []),
    ...(schema.minLength ? [checkMinLength(x, schema.minLength)] : []),
    ...(schema.maxLength ? [checkMaxLength(x, schema.maxLength)] : []),
    ...(schema.minimum ? [checkMinimum(x, schema.minimum)] : []),
    ...(schema.maximum ? [checkMaximum(x, schema.maximum)] : []),
    ...(schema.multipleOf ? [checkMultipleOf(x, schema.multipleOf)] : []),
    ...(schema.type === 'integer' ? [checkInteger(x)] : []),
    ...(schema.minItems ? [checkMinItems(x, schema.minItems)] : []),
    ...(schema.maxItems ? [checkMaxItems(x, schema.maxItems)] : []),
    ...(schema.uniqueItems === true ? [checkUniqueItems(x)] : []),
  ];
  if (checks.length < 1) {
    return 'true';
  }
  return checks.join(' && ');
}

function calculateImportPath(filePath: string) {
  const [withoutSuffix] = filePath.split('.json');

  if (withoutSuffix.startsWith(argv.base)) {
    const relativePath = path.relative(documentBase, withoutSuffix);
    if (relativePath.startsWith('.')) {
      return relativePath;
    }
    return './'.concat(relativePath);
  }
  // eslint-disable-next-line
  for (const [uri, location] of imports) {
    if (withoutSuffix.startsWith(uri)) {
      return location.concat(withoutSuffix.slice(uri.length));
    }
  }
  return withoutSuffix;
}

function calculateImportName(filePath: string) {
  // eslint-disable-next-line
  const [withoutPath] = filePath.split("/").reverse();
  const [basefile] = withoutPath.split('.json');
  return `${typenameFromKebab(basefile)}_`;
}

function fromRef(refString: string): gen.TypeReference {
  const ref = parseRef(refString);
  if (ref.filePath === '') {
    return gen.customCombinator(ref.variableName, ref.variableName, [ref.variableName]);
  }
  const importName = calculateImportName(ref.filePath);
  const importPath = calculateImportPath(ref.filePath);
  imps.add(`import * as ${importName} from '${importPath}';`);
  const variableRef = `${importName}.${ref.variableName}`;
  return gen.customCombinator(variableRef, variableRef, [importName]);
}

function isSupported(feature: string, isRoot: boolean) {
  if (isRoot && supportedAtRoot.includes(feature)) {
    return true;
  }
  return supportedEverywhere.includes(feature);
}

function fromType(schema: JSONSchema7): [gen.TypeReference] | [] {
  if (Array.isArray(schema.type)) {
    const combinators = schema.type.map((t) => {
      // eslint-disable-next-line
      switch (t) {
        case 'string':
          return gen.stringType;
        case 'number':
        case 'integer':
          return gen.numberType;
        case 'boolean':
          return gen.booleanType;
        case 'null':
          return gen.nullType;
      }
      // eslint-disable-next-line
      throw new Error(`${t}s are not supported as part of type MULTIPLES`);
    });
    if (combinators.length === 1) {
      const [combinator] = combinators;
      return [combinator];
    }
    return [gen.unionCombinator(combinators)];
  }
  switch (schema.type) {
    case 'string':
      return [gen.stringType];
    case 'number':
    case 'integer':
      return [gen.numberType];
    case 'boolean':
      return [gen.booleanType];
    case 'null':
      return [gen.nullType];
    case 'object':
      return [toInterfaceCombinator(schema)];
    case 'array':
      return [toArrayCombinator(schema)];
  }
  if (typeof schema.type !== 'undefined') {
    const escalate = notImplemented('', JSON.stringify(schema.type), 'type', true);
    if (escalate !== null) {
      return [escalate];
    }
  }
  return [];
}

function fromRequired(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('required' in schema && typeof schema.required !== 'undefined') {
    const combinator = gen.interfaceCombinator(
      schema.required.map((key) => {
        helpers.add(definedHelper);
        return gen.property(key, Defined);
      }),
    );
    return [combinator];
  }
  return [];
}

function fromContains(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('contains' in schema && typeof schema.contains !== 'undefined') {
    warning('contains field not supported');
  }
  return [];
}

function fromEnum(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('enum' in schema && typeof schema.enum !== 'undefined') {
    const combinators = schema.enum.map((s) => {
      if (s === null) {
        return gen.nullType;
      }
      switch (typeof s) {
        case 'string':
        case 'boolean':
        case 'number':
          return gen.literalCombinator(s);
      }
      // eslint-disable-next-line
      throw new Error(`${typeof s}s are not supported as part of ENUM`);
    });
    if (combinators.length === 1) {
      const [combinator] = combinators;
      return [combinator];
    }
    return [gen.unionCombinator(combinators)];
  }
  return [];
}

function fromConst(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('const' in schema && typeof schema.const !== 'undefined') {
    switch (typeof schema.const) {
      case 'string':
      case 'boolean':
      case 'number':
        return [gen.literalCombinator(schema.const)];
    }
    // eslint-disable-next-line
    throw new Error(
      `${typeof schema.const}s are not supported as part of CONST`
    );
  }
  return [];
}

function fromAllOf(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
    const combinators = schema.allOf.map((s) => fromSchema(s));
    if (combinators.length === 1) {
      const [combinator] = combinators;
      return [combinator];
    }
    return [gen.intersectionCombinator(combinators)];
  }
  return [];
}

function fromAnyOf(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
    const combinators = schema.anyOf.map((s) => fromSchema(s));
    if (combinators.length === 1) {
      const [combinator] = combinators;
      return [combinator];
    }
    return [gen.unionCombinator(combinators)];
  }
  return [];
}

function fromOneOf(schema: JSONSchema7): [gen.TypeReference] | [] {
  if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
    const combinators = schema.oneOf.map((s) => fromSchema(s));
    if (combinators.length === 1) {
      const [combinator] = combinators;
      return [combinator];
    }
    return [gen.unionCombinator(combinators)];
  }
  return [];
}

function fromSchema(schema: JSONSchema7Definition, isRoot = false): gen.TypeReference {
  if (typeof schema === 'boolean') {
    imps.add("import * as t from 'io-ts';");
    if (schema) {
      // accept anything
      return gen.unknownType;
    } else {
      // accept nothing
      return error('Not sure how to deal with a schema that matches nothing');
    }
  }
  if (
    isRoot === false &&
    typeof schema.type === 'string' &&
    ['string', 'number', 'integer'].includes(schema.type)
  ) {
    info(`primitive type "${schema.type}" used outside top-level definitions`);
  }
  // eslint-disable-next-line
  for (const key in schema) {
    if (isSupported(key, isRoot) !== true) {
      const escalate = notImplemented('', key, 'field');
      if (escalate !== null) {
        return escalate;
      }
    }
  }
  if ('$ref' in schema) {
    if (typeof schema['$ref'] === 'undefined') {
      // eslint-disable-next-line
      throw new Error("broken input");
    }
    return fromRef(schema['$ref']);
  }
  imps.add("import * as t from 'io-ts';");
  const combinators = [
    ...fromType(schema),
    ...fromRequired(schema),
    ...fromContains(schema),
    ...fromEnum(schema),
    ...fromConst(schema),
    ...fromAllOf(schema),
    ...fromAnyOf(schema),
    ...fromOneOf(schema),
  ];
  if (combinators.length > 1) {
    return gen.intersectionCombinator(combinators);
  }
  if (combinators.length === 1) {
    const [combinator] = combinators;
    return combinator;
  }
  if (generateChecks('x', schema).length > 1) {
    // skip checks
    return gen.unknownType;
  }
  // eslint-disable-next-line
  throw new Error(`unknown schema: ${JSON.stringify(schema)}`);
}

type Examples = Array<unknown>;

type DefMeta = {
  title: JSONSchema7['title'];
  description: JSONSchema7['description'];
  examples: Examples;
  defaultValue: JSONSchema7['default'];
};

type DefInput = {
  meta: DefMeta;
  dec: gen.TypeDeclaration;
};

function extractExamples(schema: JSONSchema7Definition): Examples {
  if (typeof schema === 'boolean') {
    // note that in this context true is any and false is never
    return [];
  }
  if ('$ref' in schema) {
    warning('skipping examples handling for $ref object');
    return [];
  }
  const { examples } = schema;
  if (examples instanceof Array) {
    return examples;
  }
  if (typeof examples === 'undefined') {
    return [];
  }
  // eslint-disable-next-line
  throw new Error("Unexpected format of examples");
}

function extractDefaultValue(schema: JSONSchema7Definition): JSONSchema7['default'] {
  if (typeof schema === 'boolean') {
    // note that in this context true is any and false is never
    return undefined;
  }
  if ('$ref' in schema) {
    warning('skipping default value handling for $ref object');
    return undefined;
  }
  return schema['default'];
}

function fromDefinitions(definitions2: JSONSchema7['definitions']): Array<DefInput> {
  const definitions = definitions2 ?? {};
  return Object.entries(definitions).map(
    ([k, v]: [string, JSONSchema7Definition]): DefInput => {
      const scem = v;
      const name = capitalize(k);
      const examples = extractExamples(scem);
      const defaultValue = extractDefaultValue(scem);

      if (typeof scem === 'boolean') {
        const title = undefined;
        const description = undefined;
        return {
          meta: {
            title,
            description,
            examples,
            defaultValue,
          },
          dec: gen.typeDeclaration(
            name,
            error(`Any and never types are not supported by convert.ts`),
            true,
          ),
        };
      }
      if ('$ref' in scem) {
        // ref's do not have meta data
        const title = undefined;
        const description = undefined;
        if (typeof scem['$ref'] === 'undefined') {
          // eslint-disable-next-line
          throw new Error("broken input");
        }
        return {
          meta: {
            title,
            description,
            examples,
            defaultValue,
          },
          dec: gen.typeDeclaration(name, fromRef(scem['$ref']), true),
        };
      }
      return {
        meta: {
          title: scem.title,
          description: scem.description,
          examples,
          defaultValue,
        },
        dec: gen.typeDeclaration(
          name,
          gen.brandCombinator(
            fromSchema(scem, true),
            (x) => generateChecks(x, scem),
            name,
          ),
          true,
        ),
      };
    },
  );
}

function fromNonRefRoot(schema: JSONSchema7): Array<DefInput> {
  // root schema info is printed in the beginning of the file
  const title = defaultExport;
  const description = 'The default export. More information at the top.';
  const examples = extractExamples(schema);
  const defaultValue = extractDefaultValue(schema);
  return [
    {
      meta: {
        title,
        description,
        examples,
        defaultValue,
      },
      dec: gen.typeDeclaration(
        defaultExport,
        gen.brandCombinator(
          fromSchema(schema, true),
          (x) => generateChecks(x, schema),
          defaultExport,
        ),
        true,
      ),
    },
  ];
}

function fromRoot(root: JSONSchema7): Array<DefInput> {
  // root schema info is printed in the beginning of the file
  const title = defaultExport;
  const description = 'The default export. More information at the top.';
  const examples = extractExamples(root);
  const defaultValue = extractDefaultValue(root);

  if ('$ref' in root) {
    if (typeof root['$ref'] === 'undefined') {
      // eslint-disable-next-line
      throw new Error("broken input");
    }
    exps.add(`export default ${defaultExport};`);
    return [
      {
        meta: {
          title,
          description,
          examples,
          defaultValue,
        },
        dec: gen.typeDeclaration(defaultExport, fromRef(root['$ref']), true),
      },
    ];
  }
  const items = fromNonRefRoot(root);
  if (items.length > 0) {
    imps.add("import * as t from 'io-ts';");
    exps.add(`export default ${defaultExport};`);
  }
  return items;
}

function fromFile(schema: JSONSchema7): Array<DefInput> {
  return fromDefinitions(schema.definitions).concat(fromRoot(schema));
}

type Def = {
  typeName: string;
  title: string;
  description: string;
  examples: Array<unknown>;
  defaultValue: unknown;
  staticType: string;
  runtimeType: string;
};

function constructDefs(defInputs: Array<DefInput>): Array<Def> {
  const metas: Record<string, DefMeta> = {};
  defInputs.forEach((defInput: DefInput) => {
    // eslint-disable-next-line
    metas[defInput.dec.name] = defInput.meta;
  });
  const decs = defInputs.map(({ dec }) => dec);
  // eslint-disable-next-line
  return gen.sort(decs).map((dec) => {
    const typeName = dec.name;
    const meta = metas[typeName];
    const title = meta.title ?? typeName;
    const description = meta.description ?? 'The purpose of this remains a mystery';
    const examples = meta.examples || [];
    const defaultValue = meta.defaultValue;
    const staticType = gen.printStatic(dec);
    const runtimeType = gen
      .printRuntime(dec)
      .replace(/\ninterface /, '\nexport interface ');

    if (typeof meta.description !== 'string') {
      info('missing description');
    }
    if (examples.length > 0) {
      imps.add("import { NonEmptyArray } from 'fp-ts/lib/NonEmptyArray';");
      imps.add("import { nonEmptyArray } from 'io-ts-types/lib/nonEmptyArray';");
    }
    return {
      typeName,
      title,
      description,
      examples,
      defaultValue,
      staticType,
      runtimeType,
    };
  });
}

const defs: Array<Def> = constructDefs(fromFile(inputSchema as JSONSchema7));

if (returnCode === ErrorCode.ERROR) {
  process.exit(returnCode);
}
if (returnCode === ErrorCode.WARNING && argv.strict) {
  process.exit(returnCode);
}

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

const log = (a: string) => fs.appendFileSync(fd, `${a}\n`);

log('/*');
log('');
log(`${inputSchema.title}`);
log(`${inputSchema.description}`);
log('');
log('!!! AUTO GENERATED BY IOTSFJS REFRAIN FROM MANUAL EDITING !!!');
log('See https://www.npmjs.com/package/io-ts-from-json-schema');
log('');
log('*/');
log('');
imps.forEach(log);
log('');
helpers.forEach(log);
log('');
log(`export const schemaId = '${inputSchema.$id}';`);
log('');

// eslint-disable-next-line
for (const def of defs) {
  const {
    typeName,
    title,
    description,
    examples,
    defaultValue,
    staticType,
    runtimeType,
  } = def;
  log(`// ${title}`);
  log(`// ${description}`);
  log(staticType);
  log(runtimeType);
  if (examples.length > 0) {
    const examplesName = 'examples'.concat(typeName);
    log(
      `/** require('io-ts-validator').validator(nonEmptyArray(${typeName})).decodeSync(${examplesName}) // => ${examplesName} */`,
    );
    log(
      `export const ${examplesName}: NonEmptyArray<${typeName}> = ${JSON.stringify(
        examples,
      )} as unknown as NonEmptyArray<${typeName}>;`,
    );
  }
  if (typeof defaultValue !== 'undefined') {
    const defaultName = 'default'.concat(typeName);
    log(
      `/** require('io-ts-validator').validator(${typeName}).decodeSync(${defaultName}) // => ${defaultName} */`,
    );
    log(
      `export const ${defaultName}: ${typeName} = ${JSON.stringify(
        defaultValue,
      )} as unknown as ${typeName};`,
    );
  }
  log('');
}

exps.forEach(log);
log('');
log('// Success');
fs.closeSync(fd);

process.stdout.write('.');
