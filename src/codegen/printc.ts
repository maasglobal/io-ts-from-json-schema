import * as gen from 'io-ts-codegen';

/*
  This code lives here until it becomes available upstream
  https://github.com/gcanti/io-ts-codegen/pull/62
*/

/* eslint-disable @typescript-eslint/no-use-before-define, fp/no-let, fp/no-loops, fp/no-mutation */

function printCProperty(p: gen.Property, i: number, recursion?: gen.Recursion): string {
  const optional = p.isOptional ? '?' : '';
  const type = printC(p.type, i, recursion);
  const sep = ': ';
  return (
    printDescription(p.description, i) +
    indent(i) +
    escapePropertyKey(p.key) +
    optional +
    sep +
    type
  );
}

function printCLiteralCombinator(c: gen.LiteralCombinator): string {
  let s = 't.LiteralC<';
  s += typeof c.value === 'string' ? escapeString(c.value) : String(c.value);
  s += '>';
  return s;
}

function printCInterfaceCombinator(
  c: gen.InterfaceCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  let s = 't.TypeC<{\n';
  s += c.properties.map((p) => printCProperty(p, i + 1, recursion)).join(',\n');
  s += `\n${indent(i)}}>`;
  return s;
}

function printCPartialCombinator(
  c: gen.PartialCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  let s = 't.PartialC<{\n';
  s += c.properties
    .map((p) => printCProperty({ ...p, isOptional: false }, i + 1, recursion))
    .join(',\n');
  s += `\n${indent(i)}}>`;
  return s;
}

function printCTypesCombinator(
  types: Array<gen.TypeReference>,
  i: number,
  recursion?: gen.Recursion,
): string {
  const indentation = indent(i + 1);
  return types.map((t) => `${indentation}${printC(t, i, recursion)}`).join(`,\n`);
}

function printCUnionCombinator(
  c: gen.UnionCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return 't.UnionC<[\n' + printCTypesCombinator(c.types, i, recursion) + '\n]>';
}

function printCTaggedUnionCombinator(
  c: gen.TaggedUnionCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return 't.UnionC<[\n' + printCTypesCombinator(c.types, i, recursion) + '\n]>';
}

function printCIntersectionCombinator(
  c: gen.IntersectionCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return 't.IntersectionC<[\n' + printCTypesCombinator(c.types, i, recursion) + '\n]>';
}

function printCKeyofCombinator(c: gen.KeyofCombinator, i: number): string {
  return printC(
    gen.unionCombinator(c.values.map((value) => gen.literalCombinator(value))),
    i,
  );
}

function printCArrayCombinator(
  c: gen.ArrayCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return `t.ArrayC<${printC(c.type, i, recursion)}>`;
}

function printCExactCombinator(
  c: gen.ExactCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return printC(c.type, i, recursion);
}

function printCStrictCombinator(
  c: gen.StrictCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  let s = 't.TypeC<{\n';
  s += c.properties.map((p) => printCProperty(p, i + 1, recursion)).join(',\n');
  s += `\n${indent(i)}}>`;
  return s;
}

function printCReadonlyCombinator(
  c: gen.ReadonlyCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return `t.ReadonlyC<${printC(c.type, i, recursion)}>`;
}

function printCBrandCombinator(
  bc: gen.BrandCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return `t.BrandC<${printC(bc.type, i, recursion)}, ${bc.name}Brand>`;
}

function printCReadonlyArrayCombinator(
  c: gen.ReadonlyArrayCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return `t.ReadonlyArrayC<${printC(c.type, i, recursion)}>`;
}

function printCDictionaryCombinator(
  c: gen.DictionaryCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  return `t.RecordC<${printC(c.domain, i)}, ${printC(c.codomain, i, recursion)}>`;
}

function printCTupleCombinator(
  c: gen.TupleCombinator,
  i: number,
  recursion?: gen.Recursion,
): string {
  const indentation = indent(i + 1);
  let s = 't.TupleC<[\n';
  s += c.types.map((t) => `${indentation}${printC(t, i, recursion)}`).join(',\n');
  s += `\n${indent(i)}]>`;
  return s;
}

function printCCustomTypeDeclarationType(name: string): string {
  return `// exists type ${name}C extends t.AnyC`;
}

function printCTypeDeclarationType(
  type: gen.TypeReference,
  name: string,
  isReadonly: boolean,
  isExported: boolean,
  description: string | undefined,
  recursion?: gen.Recursion,
): string {
  if (type.kind.startsWith('Custom')) {
    return printCCustomTypeDeclarationType(name);
  }
  let s = printC(type, 0, recursion);
  if (isReadonly) {
    s = `t.ReadonlyC<${s}>`;
  }
  s = `type ${name}C = ${s}`;
  if (isExported) {
    s = `export ${s}`;
  }
  return printDescription(description, 0) + s;
}

function printCTypeDeclaration(declaration: gen.TypeDeclaration): string {
  return printCTypeDeclarationType(
    declaration.type,
    declaration.name,
    declaration.isReadonly,
    declaration.isExported,
    declaration.description,
  );
}

function printCCustomTypeDeclaration(declaration: gen.CustomTypeDeclaration): string {
  return printCCustomTypeDeclarationType(declaration.name);
}

export function printC(node: gen.Node, i = 0, recursion?: gen.Recursion): string {
  switch (node.kind) {
    case 'Identifier':
      return node.name + 'C';
    case 'StringType':
    case 'NumberType':
    case 'BooleanType':
    case 'NullType':
    case 'UndefinedType':
    case 'FunctionType':
    case 'UnknownType':
      return `t.${node.name.charAt(0).toUpperCase().concat(node.name.slice(1))}C`;
    case 'IntType':
      return `t.BrandC<t.NumberC, t.${node.name}Brand>`;
    case 'IntegerType':
      return 't.NumberC';
    case 'AnyArrayType':
      return 't.UnknownArrayC';
    case 'AnyDictionaryType':
      return 't.UnknownRecordC';
    case 'LiteralCombinator':
      return printCLiteralCombinator(node);
    case 'InterfaceCombinator':
      return printCInterfaceCombinator(node, i, recursion);
    case 'PartialCombinator':
      return printCPartialCombinator(node, i, recursion);
    case 'UnionCombinator':
      return printCUnionCombinator(node, i, recursion);
    case 'TaggedUnionCombinator':
      return printCTaggedUnionCombinator(node, i, recursion);
    case 'IntersectionCombinator':
      return printCIntersectionCombinator(node, i, recursion);
    case 'KeyofCombinator':
      return printCKeyofCombinator(node, i);
    case 'ArrayCombinator':
      return printCArrayCombinator(node, i, recursion);
    case 'ReadonlyArrayCombinator':
      return printCReadonlyArrayCombinator(node, i, recursion);
    case 'TupleCombinator':
      return printCTupleCombinator(node, i, recursion);
    case 'RecursiveCombinator':
      return printC(node.type, i, recursion);
    case 'DictionaryCombinator':
      return printCDictionaryCombinator(node, i, recursion);
    case 'TypeDeclaration':
      return printCTypeDeclaration(node);
    case 'CustomTypeDeclaration':
      return printCCustomTypeDeclaration(node);
    case 'CustomCombinator':
      return `typeof ${node.runtime}`;
    case 'ExactCombinator':
      return printCExactCombinator(node, i, recursion);
    case 'StrictCombinator':
      return printCStrictCombinator(node, i, recursion);
    case 'ReadonlyCombinator':
      return printCReadonlyCombinator(node, i, recursion);
    case 'BrandCombinator':
      return printCBrandCombinator(node, i, recursion);
  }
}

/* The following formating rules were copied from io-ts-codegen */

function escapePropertyKey(key: string): string {
  return isValidPropertyKey(key) ? key : escapeString(key);
}

function indent(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += '  ';
  }
  return s;
}

function escapeString(s: string): string {
  return "'" + s.replace(/'/g, "\\'") + "'";
}

function isValidPropertyKey(s: string): boolean {
  return !/(^\d|\W)/.test(s);
}

function printDescription(description: string | undefined, i: number): string {
  if (description) {
    return `${indent(i)}/** ${description} */\n`;
  }
  return '';
}
