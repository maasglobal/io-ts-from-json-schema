import * as gen from 'io-ts-codegen';
import { JSONSchema7 } from 'json-schema';

export type Examples = Array<unknown>;
export type Invalid = Record<string, string>;

export type Def = {
  typeName: string;
  title: string;
  description: string;
  examples: Examples;
  invalid: Invalid;
  defaultValue: unknown;
  minimumValue: unknown;
  maximumValue: unknown;
  staticType: string;
  runtimeType: string;
};

export type DefMeta = {
  title: JSONSchema7['title'];
  description: JSONSchema7['description'];
  examples: Examples;
  invalid: Invalid;
  defaultValue: JSONSchema7['default'];
  minimumValue: JSONSchema7['minimum'];
  maximumValue: JSONSchema7['maximum'];
};

export type DefInput = {
  meta: DefMeta;
  dec: gen.TypeDeclaration;
};
