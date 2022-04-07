#!/usr/bin/env node

import * as crypto from 'crypto';
import * as gen from 'io-ts-codegen';
import { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import * as path from 'path';
import * as stream from 'stream';

import { printC } from './codegen/printc';
import { Def, DefInput, DefMeta, Examples, Invalid } from './types/def';
import { fromHyper } from './vocab/hyper';

export type Args = {
  import: Array<string>;
  documentURI: string;
  inputFile: string;
  base: string;
  importHashLength: number;
  importHashAlgorithm: string;
  strict: boolean;
  maskNull: boolean;
};

/* eslint-disable @typescript-eslint/no-use-before-define */

export function* iotsfjs(
  inputSchema: JSONSchema7,
  args: Args,
  stderr: stream.Writable,
): Generator<string, void, undefined> {
  type URI = string;
  type Location = string;
  const imports: Array<[URI, Location]> = args.import.map(
    (imp: string) => imp.split('^') as [URI, Location],
  );

  const genNeverType = gen.intersectionCombinator([
    gen.literalCombinator(true),
    gen.literalCombinator(false),
  ]);

  const genIntersectionCombinator = (
    combinators: Array<gen.TypeReference>,
  ): [gen.TypeReference] | [] => {
    if (combinators.length > 1) {
      const intersection = gen.intersectionCombinator(combinators);
      return [intersection];
    }
    const [first] = combinators;
    if (typeof first === 'undefined') {
      return [];
    }
    return [first];
  };

  const genUnionCombinator = (
    combinators: Array<gen.TypeReference>,
  ): [gen.TypeReference] | [] => {
    if (combinators.length > 1) {
      const union = gen.unionCombinator(combinators);
      return [union];
    }
    const [first] = combinators;
    if (typeof first === 'undefined') {
      return [];
    }
    return [first];
  };

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
    if (typeof flags === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    return { pattern, flags };
  }

  function getRegexpObject(regexp: AjvKeywordsRegexp): AjvKeywordsRegexpObject {
    if (isRegexpString(regexp)) {
      return regexpObjectFromString(regexp);
    }
    if (isRegexpObject(regexp)) {
      return regexp;
    }
    // eslint-disable-next-line fp/no-throw
    throw new Error('unknown regexp format');
  }

  // END: Ajv Schema Helpers

  function capitalize(word: string) {
    const empty = '' as const;
    const [c, ...cs] = word.split(empty);
    if (typeof c === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
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
    if (typeof withoutPath === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    const [withoutExtension] = withoutPath.split('.json');
    if (typeof withoutExtension === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    return typenameFromRandom(withoutExtension);
  }

  const definedHelper = `
export type Defined = {} | null
export class DefinedType extends t.Type<Defined> {
  readonly _tag: 'DefinedType' = 'DefinedType'
  constructor() {
    super(
      'defined',
      (u): u is Defined => typeof u !== 'undefined',
      (u, c) => (this.is(u) ? t.success(u) : t.failure(u, c)),
      t.identity
    )
  }
}
export interface DefinedC extends DefinedType {}
export const Defined: DefinedC = new DefinedType()
`;

  const Defined = gen.customCombinator('Defined', 'Defined');

  const nullHelper = `
export interface NullBrand {
  readonly Null: unique symbol
}
export type NullC = t.BrandC<t.UnknownC, NullBrand>;
export const Null: NullC = t.brand(
  t.unknown,
  (n): n is t.Branded<unknown, NullBrand> => n === null,
  'Null'
)
export type Null = t.TypeOf<typeof Null>
`;

  const Null = gen.customCombinator('Null', 'Null');

  const supportedEverywhere = [
    '$id',
    '$comment',
    'title',
    'description',
    'definitions',
    'type',
    'properties',
    'propertyNames',
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
    '$schema',
    'minimum',
    'maximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'regexp',
    'format',
    'minItems',
    'maxItems',
    'uniqueItems',
    'default',
    'examples',
    'invalid',
    'links',
  ];
  const supportedOutsideRoot = ['$ref'];

  const documentBase = (() => {
    const [, ...reversePath] = args.documentURI.split('/').reverse();
    return reversePath.reverse().join('/');
  })();

  const defaultExport = getDefaultExport(args.inputFile);

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
  // eslint-disable-next-line fp/no-let
  let returnCode: ReturnCode = OK;

  function updateFailure(level: ErrorCode) {
    if (returnCode === ErrorCode.ERROR) {
      return;
    }
    // eslint-disable-next-line fp/no-mutation
    returnCode = level;
  }

  function reportError(level: 'INFO' | 'WARNING' | 'ERROR', message: string) {
    const lines = [`${level}: ${message}`, `  in ${args.inputFile}`];
    stderr.write(lines.join('\n').concat('\n'));
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

  function notImplemented(item: string, kind: string): void {
    const isOutsideRoot = supportedAtRoot.includes(item);
    const where = isOutsideRoot ? 'outside top-level definitions' : '';
    const message = [item, kind, 'not supported', where]
      .filter((s) => s.length > 0)
      .join(' ');
    warning(message);
  }

  type Ref = {
    filePath: string;
    variableName: string;
  };
  function parseRef(ref: string): Ref {
    const parts = ref.split('#');
    if (parts.length === 1) {
      const [filePath] = parts;
      if (typeof filePath === 'undefined') {
        // eslint-disable-next-line fp/no-throw
        throw new Error('assert false');
      }
      return { filePath, variableName: getDefaultExport(filePath) };
    }
    if (parts.length > 2) {
      // eslint-disable-next-line fp/no-throw
      throw new Error('unknown ref format');
    }
    const [filePath, jsonPath] = parts;
    if (typeof jsonPath === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    const jsonPathParts = jsonPath.split('/');
    if (jsonPathParts.length !== 3) {
      // eslint-disable-next-line fp/no-throw
      throw new Error('unknown ref format');
    }
    const [empty, definitions, name] = jsonPathParts;
    if (empty !== '') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('unknown ref format');
    }
    if (definitions !== 'definitions') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('unknown ref format');
    }
    if (typeof name === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    const variableName = typenameFromKebab(name);
    if (typeof filePath === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    return { filePath, variableName };
  }

  type JSVar = string;
  type JSBoolean = string;

  function checkFormat(jx: JSVar, format: string): JSBoolean {
    if (format === 'ipv4') {
      return `( typeof ${jx} !== 'string' || ((octets) => octets.length === 4 && octets.map(Number).every((octet) => Number.isInteger(octet) && octet >= 0x00 && octet <= 0xff))(${jx}.split('.')) )`;
    }
    notImplemented(format, 'format');
    return String(true);
  }

  function checkPattern(jx: JSVar, pattern: string): JSBoolean {
    const stringLiteral = JSON.stringify(pattern);
    return `( typeof ${jx} !== 'string' || ${jx}.match(RegExp(${stringLiteral})) !== null )`;
  }

  function checkRegexp(jx: JSVar, regexp: AjvKeywordsRegexp): JSBoolean {
    const { pattern, flags } = getRegexpObject(regexp);
    const patternLiteral = JSON.stringify(pattern);
    const flagsLiteral = JSON.stringify(flags);
    return `( typeof ${jx} !== 'string' || ${jx}.match(RegExp(${patternLiteral}, ${flagsLiteral})) !== null )`;
  }

  function checkMinLength(jx: JSVar, minLength: number): JSBoolean {
    return `( typeof ${jx} !== 'string' || ${jx}.length >= ${minLength} )`;
  }

  function checkMaxLength(jx: JSVar, maxLength: number): JSBoolean {
    return `( typeof ${jx} !== 'string' || ${jx}.length <= ${maxLength} )`;
  }

  function checkMinimum(jx: JSVar, minimum: number): JSBoolean {
    return `( typeof ${jx} !== 'number' || ${jx} >= ${minimum} )`;
  }

  function checkMaximum(jx: JSVar, maximum: number): JSBoolean {
    return `( typeof ${jx} !== 'number' || ${jx} <= ${maximum} )`;
  }

  function checkMultipleOf(jx: JSVar, divisor: number): JSBoolean {
    return `( typeof ${jx} !== 'number' || ${jx} % ${divisor} === 0 )`;
  }

  function checkInteger(jx: JSVar): JSBoolean {
    return `( Number.isInteger(${jx}) )`;
  }

  function checkMinItems(jx: JSVar, minItems: number): JSBoolean {
    return `( Array.isArray(${jx}) === false || ${jx}.length >= ${minItems} )`;
  }

  function checkMaxItems(jx: JSVar, maxItems: number): JSBoolean {
    return `( Array.isArray(${jx}) === false || ${jx}.length <= ${maxItems} )`;
  }

  function checkUniqueItems(jx: JSVar): JSBoolean {
    return `( Array.isArray(${jx}) === false || ${jx}.length === [...new Set(${jx})].length )`;
  }

  function generateChecks(jx: JSVar, schema: JSONSchema7): JSBoolean {
    const checks: Array<string> = [
      ...(schema.pattern ? [checkPattern(jx, schema.pattern)] : []),
      ...((schema as AjvSchema).regexp
        ? [checkRegexp(jx, (schema as AjvSchema).regexp)]
        : []),
      ...(schema.format ? [checkFormat(jx, schema.format)] : []),
      ...(schema.minLength ? [checkMinLength(jx, schema.minLength)] : []),
      ...(schema.maxLength ? [checkMaxLength(jx, schema.maxLength)] : []),
      ...(schema.minimum ? [checkMinimum(jx, schema.minimum)] : []),
      ...(schema.maximum ? [checkMaximum(jx, schema.maximum)] : []),
      ...(schema.multipleOf ? [checkMultipleOf(jx, schema.multipleOf)] : []),
      ...(schema.type === 'integer' ? [checkInteger(jx)] : []),
      ...(schema.minItems ? [checkMinItems(jx, schema.minItems)] : []),
      ...(schema.maxItems ? [checkMaxItems(jx, schema.maxItems)] : []),
      ...(schema.uniqueItems === true ? [checkUniqueItems(jx)] : []),
    ];
    if (checks.length < 1) {
      return 'true';
    }
    return checks.join(' && ');
  }

  function calculateImportPath(filePath: string) {
    const [withoutSuffix] = filePath.split('.json');
    if (typeof withoutSuffix === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    if (withoutSuffix.startsWith(args.base)) {
      const relativePath = path.relative(documentBase, withoutSuffix);
      if (relativePath.startsWith('.')) {
        return relativePath;
      }
      return './'.concat(relativePath);
    }
    // eslint-disable-next-line fp/no-loops
    for (const [uri, location] of imports) {
      if (withoutSuffix.startsWith(uri)) {
        return location.concat(withoutSuffix.slice(uri.length));
      }
    }
    return './'.concat(withoutSuffix);
  }

  function importBaseName(filePath: string): string {
    const [withoutPath] = filePath.split('/').reverse();
    if (typeof withoutPath === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    const [basefile] = withoutPath.split('.json');
    if (typeof basefile === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    const typeName = typenameFromKebab(basefile);
    return typeName.concat('_');
  }

  function importHashName(refString: string): string {
    if (args.importHashLength === 0) {
      return '';
    }
    const [withoutFragment] = refString.split('#');
    if (typeof withoutFragment === 'undefined') {
      // eslint-disable-next-line fp/no-throw
      throw new Error('assert false');
    }
    const fullDigest = crypto
      .createHash(args.importHashAlgorithm)
      .update(withoutFragment)
      .digest('hex');
    const shortDigest = fullDigest.slice(0, args.importHashLength);
    return shortDigest.concat('_');
  }

  function calculateImportName(filePath: string, refString: string) {
    const baseName = importBaseName(filePath);
    const hashName = importHashName(refString);
    return baseName.concat(hashName);
  }

  type RefObject = JSONSchema7 & { $ref: string };
  function isRefObject(schema: JSONSchema7): schema is RefObject {
    if (schema.hasOwnProperty('$ref') === false) {
      return false;
    }
    if (typeof schema['$ref'] === 'string') {
      return true;
    }
    // eslint-disable-next-line fp/no-throw
    throw new Error('broken input');
  }

  function fromRef(refObject: RefObject): gen.TypeReference {
    const { $ref: refString, $comment: _comment, ...extra } = refObject;

    if (Object.keys(extra).length) {
      warning(`unexpected key in a $ref object`);
    }

    // eslint-disable-next-line fp/no-let
    let ref;
    try {
      // eslint-disable-next-line fp/no-mutation
      ref = parseRef(refString);
    } catch {
      return error('Failed to parse reference');
    }

    if (ref.filePath === '') {
      return gen.customCombinator(ref.variableName, ref.variableName, [ref.variableName]);
    }
    const importName = calculateImportName(ref.filePath, refString);
    const importPath = calculateImportPath(ref.filePath);
    imps.add(`import * as ${importName} from '${importPath}';`);

    const variableRef = `${importName}.${ref.variableName}`;
    return gen.customCombinator(variableRef, variableRef, [importName]);
  }

  function isSupported(feature: string, isRoot: boolean) {
    if (supportedEverywhere.includes(feature)) {
      return true;
    }
    if (isRoot) {
      return supportedAtRoot.includes(feature);
    }
    return supportedOutsideRoot.includes(feature);
  }

  function fromType(schema: JSONSchema7): [gen.TypeReference] | [] {
    if (typeof schema.type === 'undefined') {
      return [];
    }
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];

    const combinators = types.flatMap((t): [gen.TypeReference] | [] => {
      switch (t) {
        case 'string':
          return [gen.stringType];
        case 'number':
        case 'integer':
          return [gen.numberType];
        case 'boolean':
          return [gen.booleanType];
        case 'null':
          if (args.maskNull) {
            helpers.add(nullHelper);
            return [Null];
          }
          return [gen.nullType];
        case 'array':
          if (schema.hasOwnProperty('items')) {
            return []; // trust items validator to validate array
          }
          return [gen.unknownArrayType];
        case 'object':
          if (schema.hasOwnProperty('properties')) {
            return []; // trust properties validator to validate object
          }
          if (schema.hasOwnProperty('patternProperties')) {
            return []; // trust pattern properties validator to validate object
          }
          if (schema.hasOwnProperty('propertyNames')) {
            return []; // trust property names validator to validate object
          }
          if (schema.hasOwnProperty('additionalProperties')) {
            return []; // trust additional properties validator to validate object
          }
          return [gen.unknownRecordType];
        default:
          notImplemented(JSON.stringify(schema.type), 'type');
          return [gen.unknownType];
      }
    });

    return genUnionCombinator(combinators);
  }

  function fromProperties(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('properties' in schema && typeof schema.properties !== 'undefined') {
      if (schema.type !== 'object') {
        // eslint-disable-next-line fp/no-throw
        throw new Error(
          'properties keyword is not supported outside explicit object definitions. See https://github.com/maasglobal/io-ts-from-json-schema/issues/33',
        );
      }
      const combinator = gen.partialCombinator(
        Object.entries(schema.properties).map(
          <K extends string, V>([key, value]: [K, V]) =>
            gen.property(key, fromSchema(value)),
        ),
      );
      return [combinator];
    }
    return [];
  }

  function fromPropertyNames(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('propertyNames' in schema && typeof schema.propertyNames !== 'undefined') {
      if (schema.type !== 'object') {
        // eslint-disable-next-line fp/no-throw
        throw new Error(
          'propertyNames keyword is not supported outside explicit object definitions. See https://github.com/maasglobal/io-ts-from-json-schema/issues/33',
        );
      }

      return [gen.recordCombinator(fromSchema(schema.propertyNames), gen.unknownType)];
    }
    return [];
  }

  function fromPatternProperties(schema: JSONSchema7): [gen.TypeReference] | [] {
    if (
      'patternProperties' in schema &&
      typeof schema.patternProperties !== 'undefined'
    ) {
      if (schema.type !== 'object') {
        // eslint-disable-next-line fp/no-throw
        throw new Error(
          'patternProperties keyword is not supported outside explicit object definitions. See https://github.com/maasglobal/io-ts-from-json-schema/issues/33',
        );
      }

      // the mapping from pattern to item is lost in the process
      // See https://github.com/microsoft/TypeScript/issues/6579
      warning('patternProperty support has limitations');

      type Pattern = string;

      // The Record must also support non-pattern properties
      const exactPairs = Object.entries(schema.properties ?? {}).map(
        <V>([key, value]: [string, V]): [Pattern, V] => [`^${key}$`, value],
      );
      const fuzzyPairs = Object.entries(schema.patternProperties);
      const allPairs = exactPairs.concat(fuzzyPairs);
      const valueCombinators = allPairs.map(
        <K extends string, V>([_key, value]: [K, V]) => fromSchema(value),
      );

      const [valueCombinator] = genUnionCombinator(valueCombinators);
      if (typeof valueCombinator !== 'undefined') {
        return [gen.recordCombinator(gen.stringType, valueCombinator)];
      }
    }
    return [];
  }

  function fromAdditionalProperties(schema: JSONSchema7): [gen.TypeReference] | [] {
    if (
      'additionalProperties' in schema &&
      typeof schema.additionalProperties !== 'undefined'
    ) {
      if (schema.type !== 'object') {
        // eslint-disable-next-line fp/no-throw
        throw new Error(
          'additionalProperties keyword is not supported outside explicit object definitions. See https://github.com/maasglobal/io-ts-from-json-schema/issues/33',
        );
      }
      if (schema.additionalProperties === false) {
        // avoid problems related to Record<string, never>
        return [];
      }

      return [
        gen.recordCombinator(gen.stringType, fromSchema(schema.additionalProperties)),
      ];
    }
    return [];
  }

  function fromPropertyRules(schema: JSONSchema7): [gen.TypeReference] | [] {
    return genIntersectionCombinator([
      ...fromProperties(schema),
      ...fromPropertyNames(schema),
      ...fromPatternProperties(schema),
      ...fromAdditionalProperties(schema),
    ]);
  }

  function fromRequired(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('required' in schema && typeof schema.required !== 'undefined') {
      const combinator = gen.typeCombinator(
        schema.required.map((key) => {
          helpers.add(definedHelper);
          return gen.property(key, Defined);
        }),
      );
      return [combinator];
    }
    return [];
  }

  function fromObjectKeywords(schema: JSONSchema7): Array<gen.TypeReference> {
    return [...fromPropertyRules(schema), ...fromRequired(schema)];
  }

  function fromItems(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('items' in schema && typeof schema.items !== 'undefined') {
      if (schema.type !== 'array') {
        // eslint-disable-next-line fp/no-throw
        throw new Error(
          'items keyword is not supported outside explicit array definitions. See https://github.com/maasglobal/io-ts-from-json-schema/issues/33',
        );
      }
      if (schema.items === true) {
        // anything goes
        return [];
      }
      if (schema.items === false) {
        // no item is valid, empty tuple
        return [gen.tupleCombinator([])];
      }
      if (schema.items instanceof Array) {
        // tuple
        if ('additionalItems' in schema && schema.additionalItems === false) {
          const combinators = schema.items.map((s) => fromSchema(s));
          return [gen.tupleCombinator(combinators)];
        }
        // eslint-disable-next-line fp/no-throw
        throw new Error(
          'tuples with ...rest are not supported, set additionalItems false',
        );
      }
      // array
      return [gen.arrayCombinator(fromSchema(schema.items))];
    }
    return [];
  }

  function fromContains(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('contains' in schema && typeof schema.contains !== 'undefined') {
      warning('contains field not supported');
    }
    return [];
  }

  function fromArrayKeywords(schema: JSONSchema7): Array<gen.TypeReference> {
    return [...fromItems(schema), ...fromContains(schema)];
  }

  function fromEnum(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('enum' in schema && typeof schema.enum !== 'undefined') {
      const combinators = schema.enum.map((s) => {
        if (s === null) {
          if (args.maskNull) {
            helpers.add(nullHelper);
            return Null;
          }
          return gen.nullType;
        }
        switch (typeof s) {
          case 'string':
          case 'boolean':
          case 'number':
            return gen.literalCombinator(s);
        }
        // eslint-disable-next-line fp/no-throw
        throw new Error(`${typeof s}s are not supported as part of ENUM`);
      });
      return genUnionCombinator(combinators);
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
      // eslint-disable-next-line fp/no-throw
      throw new Error(`${typeof schema.const}s are not supported as part of CONST`);
    }
    return [];
  }

  function fromAllOf(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('allOf' in schema && typeof schema.allOf !== 'undefined') {
      const combinators = schema.allOf.map((s) => fromSchema(s));
      if (combinators.length === 1) {
        const [combinator] = combinators;

        if (typeof combinator === 'undefined') {
          // eslint-disable-next-line fp/no-throw
          throw new Error('assert false');
        }

        return [combinator];
      }
      return [gen.intersectionCombinator(combinators)];
    }
    return [];
  }

  function fromAnyOf(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('anyOf' in schema && typeof schema.anyOf !== 'undefined') {
      const combinators = schema.anyOf.map((s) => fromSchema(s));
      return genUnionCombinator(combinators);
    }
    return [];
  }

  function fromOneOf(schema: JSONSchema7): [gen.TypeReference] | [] {
    if ('oneOf' in schema && typeof schema.oneOf !== 'undefined') {
      const combinators = schema.oneOf.map((s) => fromSchema(s));
      return genUnionCombinator(combinators);
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
        return genNeverType;
      }
    }
    if (
      isRoot === false &&
      typeof schema.type === 'string' &&
      ['string', 'number', 'integer'].includes(schema.type)
    ) {
      info(`primitive type "${schema.type}" used outside top-level definitions`);
    }
    // eslint-disable-next-line fp/no-loops
    for (const key in schema) {
      if (isSupported(key, isRoot) !== true) {
        notImplemented(key, 'field');
      }
    }
    if (isRefObject(schema)) {
      return fromRef(schema);
    }
    imps.add("import * as t from 'io-ts';");
    const combinators = [
      ...fromType(schema),
      ...fromObjectKeywords(schema),
      ...fromArrayKeywords(schema),
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
      if (typeof combinator === 'undefined') {
        // eslint-disable-next-line fp/no-throw
        throw new Error('assert false');
      }
      return combinator;
    }
    if (generateChecks('x', schema).length > 1) {
      // skip checks
      return gen.unknownType;
    }
    // eslint-disable-next-line fp/no-throw
    throw new Error(`unknown schema: ${JSON.stringify(schema)}`);
  }

  function extractTitleValue(schema: JSONSchema7): JSONSchema7['title'] {
    if ('$ref' in schema) {
      warning('skipping title value handling for $ref object');
      return undefined;
    }
    return schema['title'];
  }

  function extractDescriptionValue(schema: JSONSchema7): JSONSchema7['description'] {
    if ('$ref' in schema) {
      warning('skipping description value handling for $ref object');
      return undefined;
    }
    return schema['description'];
  }

  function extractExamples(schema: JSONSchema7): Examples {
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
    // eslint-disable-next-line fp/no-throw
    throw new Error('Unexpected format of examples');
  }

  function extractInvalid(schema: JSONSchema7): Invalid {
    if ('$ref' in schema) {
      warning('skipping invalid examples handling for $ref object');
      return {};
    }
    const { invalid } = schema as any;
    if (typeof invalid === 'object') {
      return invalid;
    }
    if (typeof invalid === 'undefined') {
      return {};
    }
    // eslint-disable-next-line fp/no-throw
    throw new Error('Unexpected format of invalid examples');
  }

  function extractDefaultValue(schema: JSONSchema7): JSONSchema7['default'] {
    if ('$ref' in schema) {
      warning('skipping default value handling for $ref object');
      return undefined;
    }
    return schema['default'];
  }

  function extractMinimumValue(schema: JSONSchema7): JSONSchema7['minimum'] {
    if ('$ref' in schema) {
      warning('skipping minimum value handling for $ref object');
      return undefined;
    }
    return schema['minimum'];
  }

  function extractMaximumValue(schema: JSONSchema7): JSONSchema7['maximum'] {
    if ('$ref' in schema) {
      warning('skipping maximum value handling for $ref object');
      return undefined;
    }
    return schema['maximum'];
  }

  function extractMeta(scem: JSONSchema7Definition): DefMeta {
    if (typeof scem === 'boolean') {
      // note that in this context true is any and false is never
      return {
        title: undefined,
        description: undefined,
        examples: [],
        invalid: {},
        defaultValue: undefined,
        minimumValue: undefined,
        maximumValue: undefined,
      };
    }
    if (isRefObject(scem)) {
      // ref's do not have meta data
      return {
        title: undefined,
        description: undefined,
        examples: [],
        invalid: {},
        defaultValue: undefined,
        minimumValue: undefined,
        maximumValue: undefined,
      };
    }
    return {
      title: extractTitleValue(scem),
      description: extractDescriptionValue(scem),
      examples: extractExamples(scem),
      invalid: extractInvalid(scem),
      defaultValue: extractDefaultValue(scem),
      minimumValue: extractMinimumValue(scem),
      maximumValue: extractMaximumValue(scem),
    };
  }

  function fromDefinitions(definitions2: JSONSchema7['definitions']): Array<DefInput> {
    const definitions = definitions2 ?? {};
    return Object.entries(definitions).flatMap(
      ([k, v]: [string, JSONSchema7Definition]): Array<DefInput> => {
        const scem = v;
        const name = capitalize(k);

        if (typeof scem === 'boolean') {
          return [
            {
              meta: extractMeta(scem),
              dec: gen.typeDeclaration(
                name,
                gen.brandCombinator(
                  scem ? gen.unknownType : genNeverType,
                  (_x) => String(scem),
                  name,
                ),
                true,
              ),
            },
          ];
        }
        if (isRefObject(scem)) {
          // ref's do not have meta data
          return [
            {
              meta: extractMeta(scem),
              dec: gen.typeDeclaration(
                name,
                gen.brandCombinator(fromRef(scem), (_x) => String(true), name),
                true,
              ),
            },
          ];
        }
        return [
          {
            meta: extractMeta(scem),
            dec: gen.typeDeclaration(
              name,
              gen.brandCombinator(
                fromSchema(scem, true),
                (jx) => generateChecks(jx, scem),
                name,
              ),
              true,
            ),
          },
        ];
      },
    );
  }

  function fromRoot(root: JSONSchema7): Array<DefInput> {
    if (root.hasOwnProperty('$schema') === false) {
      warning(`missing $schema declaration`);
    }

    imps.add("import * as t from 'io-ts';");
    exps.add(`export default ${defaultExport};`);

    return [
      {
        meta: {
          ...extractMeta(root),
          // root schema info is printed in the beginning of the file
          title: defaultExport,
          description: 'The default export. More information at the top.',
        },
        dec: gen.typeDeclaration(
          defaultExport,
          gen.brandCombinator(
            isRefObject(root)
              ? error('schema root can not be a $ref object')
              : fromSchema(root, true),
            (jx) => generateChecks(jx, root),
            defaultExport,
          ),
          true,
        ),
      },
    ];
  }

  function fromFile(schema: JSONSchema7): Array<DefInput> {
    const namedDefs = fromDefinitions(schema.definitions);
    if (namedDefs.map(({ dec: { name } }) => name).includes(defaultExport)) {
      warning('naming clash, ignoring default export');
      return namedDefs;
    }
    const rootDef = fromRoot(schema);
    const hyperDef = fromHyper({
      defaultExport,
      extractMeta,
      imps,
      exps,
      fromSchema,
      generateChecks,
    })(schema);
    return namedDefs.concat(rootDef).concat(hyperDef);
  }

  function constructDefs(defInputs: Array<DefInput>): Array<Def> {
    const metas: Record<string, DefMeta> = {};
    defInputs.forEach((defInput: DefInput) => {
      // eslint-disable-next-line fp/no-mutation
      metas[defInput.dec.name] = defInput.meta;
    });
    const decs = defInputs.map(({ dec }) => dec);
    return gen.sort(decs).map((dec) => {
      const typeName = dec.name;
      const meta = metas[typeName];
      if (typeof meta === 'undefined') {
        // eslint-disable-next-line fp/no-throw
        throw new Error('assert false');
      }
      const title = meta.title ?? typeName;
      const description = meta.description ?? 'The purpose of this remains a mystery';
      const examples = meta.examples || [];
      const invalid = meta.invalid || {};
      const defaultValue = meta.defaultValue;
      const minimumValue = meta.minimumValue;
      const maximumValue = meta.maximumValue;
      const staticType = gen.printStatic(dec);
      const runtimeType = printC(dec)
        .concat('\n')
        .concat(gen.printRuntime(dec))
        .replace(`const ${typeName} `, `const ${typeName}: ${typeName}C `)
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
        invalid,
        defaultValue,
        minimumValue,
        maximumValue,
        staticType,
        runtimeType,
      };
    });
  }

  const inputs: Array<DefInput> = fromFile(inputSchema as JSONSchema7);
  const defs: Array<Def> = constructDefs(inputs);

  if (returnCode === ErrorCode.ERROR) {
    // eslint-disable-next-line fp/no-throw
    throw new Error('Bailing because of errors');
  }
  if (returnCode === ErrorCode.WARNING && args.strict) {
    // eslint-disable-next-line fp/no-throw
    throw new Error('Bailing because of warnings');
  }
  yield '/*';
  yield '';
  yield `${inputSchema.title}`;
  yield `${inputSchema.description}`;
  yield '';
  yield '!!! AUTO GENERATED BY IOTSFJS REFRAIN FROM MANUAL EDITING !!!';
  yield 'See https://www.npmjs.com/package/io-ts-from-json-schema';
  yield '';
  yield '*/';
  yield '';
  yield* imps;
  yield '';
  yield* helpers;
  yield '';
  yield `export const schemaId = '${inputSchema.$id}';`;
  yield '';

  // eslint-disable-next-line fp/no-loops
  for (const def of defs) {
    const {
      typeName,
      title,
      description,
      examples,
      invalid,
      defaultValue,
      minimumValue,
      maximumValue,
      staticType,
      runtimeType,
    } = def;
    yield `// ${title}`;
    yield `// ${description}`;
    yield staticType;
    yield runtimeType;
    if (examples.length > 0) {
      const examplesName = 'examples'.concat(typeName);
      yield `/** require('io-ts-validator').validator(nonEmptyArray(${typeName})).decodeSync(${examplesName}) // => ${examplesName} */`;
      yield `export const ${examplesName}: NonEmptyArray<${typeName}> = ${JSON.stringify(
        examples,
      )} as unknown as NonEmptyArray<${typeName}>;`;
    }
    // eslint-disable-next-line fp/no-loops
    for (const [b64, description] of Object.entries(invalid)) {
      yield `// NEGATIVE Test Case: ${description}`;
      const negativeTestCase = Buffer.from(b64, 'base64').toString('ascii');
      yield `/** require('io-ts-validator').validator(${typeName}).decodeEither(${negativeTestCase})._tag // => 'Left' */`;
    }
    if (typeof defaultValue !== 'undefined') {
      const defaultName = 'default'.concat(typeName);
      yield `/** require('io-ts-validator').validator(${typeName}).decodeSync(${defaultName}) // => ${defaultName} */`;
      yield `export const ${defaultName}: ${typeName} = ${JSON.stringify(
        defaultValue,
      )} as unknown as ${typeName};`;
    }
    if (typeof minimumValue !== 'undefined') {
      const minimumName = 'minimum'.concat(typeName);
      yield `/** require('io-ts-validator').validator(${typeName}).decodeSync(${minimumName}) // => ${minimumName} */`;
      yield `export const ${minimumName}: ${typeName} = ${JSON.stringify(
        minimumValue,
      )} as unknown as ${typeName};`;
    }
    if (typeof maximumValue !== 'undefined') {
      const maximumName = 'maximum'.concat(typeName);
      yield `/** require('io-ts-validator').validator(${typeName}).decodeSync(${maximumName}) // => ${maximumName} */`;
      yield `export const ${maximumName}: ${typeName} = ${JSON.stringify(
        maximumValue,
      )} as unknown as ${typeName};`;
    }
    yield '';
  }

  yield* exps;
  yield '';
  yield '// Success';
}
