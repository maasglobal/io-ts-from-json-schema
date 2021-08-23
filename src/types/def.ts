import * as gen from 'io-ts-codegen';
import { JSONSchema7 } from 'json-schema';

export type Def = {
  typeName: string;
  title: string;
  description: string;
  examples: Array<unknown>;
  defaultValue: unknown;
  minimumValue: unknown;
  maximumValue: unknown;
  staticType: string;
  runtimeType: string;
};

export type Examples = Array<unknown>;

export type DefMeta = {
  title: JSONSchema7['title'];
  description: JSONSchema7['description'];
  examples: Examples;
  defaultValue: JSONSchema7['default'];
  minimumValue: JSONSchema7['minimum'];
  maximumValue: JSONSchema7['maximum'];
};

export type DefInput = {
  meta: DefMeta;
  dec: gen.TypeDeclaration;
};
