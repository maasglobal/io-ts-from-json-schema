import * as assert from 'assert';
import * as gen from 'io-ts-codegen';

import { printC } from '../printc';

describe('printC', () => {
  it('literalCombinator', () => {
    const declaration = gen.typeDeclaration('Foo', gen.literalCombinator(1));
    assert.strictEqual(printC(declaration), `type FooC = t.LiteralC<1>`);
  });

  it('intersectionCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.intersectionCombinator([gen.stringType, gen.numberType]),
    );
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.IntersectionC<[
  t.StringC,
  t.NumberC
]>`,
    );
  });

  it('keyofCombinator', () => {
    const declaration = gen.typeDeclaration('Foo', gen.keyofCombinator(['a', 'b']));
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.UnionC<[
  t.LiteralC<'a'>,
  t.LiteralC<'b'>
]>`,
    );
  });

  it('tupleCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.tupleCombinator([gen.stringType, gen.numberType]),
    );
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.TupleC<[
  t.StringC,
  t.NumberC
]>`,
    );
  });

  describe('taggedUnionCombinator', () => {
    it('should print a union', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.taggedUnionCombinator('type', [
          gen.typeCombinator([gen.property('type', gen.literalCombinator('A'))]),
          gen.typeCombinator([gen.property('type', gen.literalCombinator('B'))]),
        ]),
      );
      assert.strictEqual(
        printC(declaration),
        `type FooC = t.UnionC<[
  t.TypeC<{
  type: t.LiteralC<'A'>
}>,
  t.TypeC<{
  type: t.LiteralC<'B'>
}>
]>`,
      );
    });
  });

  describe('getRecursiveTypeDeclaration', () => {
    it('should handle indentifiers', () => {
      const declaration = gen.getRecursiveTypeDeclaration(
        gen.typeDeclaration(
          'BExpr',
          gen.taggedUnionCombinator('t', [
            gen.identifier('Lit_bV'),
            gen.identifier('NotV'),
            gen.identifier('AndV'),
          ]),
        ),
      );
      assert.strictEqual(
        printC(declaration),
        `type BExprC = t.UnionC<[
  Lit_bVC,
  NotVC,
  AndVC
]>`,
      );
    });
  });

  describe('typeCombinator', () => {
    it('should handle field descriptions', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([gen.property('a', gen.stringType, false, 'description')]),
      );
      assert.strictEqual(
        printC(declaration),
        `type FooC = t.TypeC<{
  /** description */
  a: t.StringC
}>`,
      );
    });

    it('should handle required properties', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([
          gen.property('foo', gen.stringType),
          gen.property('bar', gen.numberType),
        ]),
      );
      assert.strictEqual(
        printC(declaration),
        `type FooC = t.TypeC<{
  foo: t.StringC,
  bar: t.NumberC
}>`,
      );
    });

    it('should handle optional properties', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([
          gen.property('foo', gen.stringType),
          gen.property('bar', gen.numberType, true),
        ]),
      );
      assert.strictEqual(
        printC(declaration),
        `type FooC = t.TypeC<{
  foo: t.StringC,
  bar?: t.NumberC
}>`,
      );
    });

    it('should handle nested types', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([
          gen.property('foo', gen.stringType),
          gen.property('bar', gen.typeCombinator([gen.property('baz', gen.numberType)])),
        ]),
      );
      assert.strictEqual(
        printC(declaration),
        `type FooC = t.TypeC<{
  foo: t.StringC,
  bar: t.TypeC<{
    baz: t.NumberC
  }>
}>`,
      );
    });

    it('should escape properties', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([
          gen.property('foo bar', gen.stringType),
          gen.property('image/jpeg', gen.stringType),
          gen.property('foo[bar]', gen.stringType),
        ]),
      );
      assert.strictEqual(
        printC(declaration),
        `type FooC = t.TypeC<{
  'foo bar': t.StringC,
  'image/jpeg': t.StringC,
  'foo[bar]': t.StringC
}>`,
      );
    });
  });

  describe('typeDeclaration', () => {
    it('should handle the isExported argument', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([gen.property('foo', gen.stringType)], 'FooC'),
        true,
      );
      assert.strictEqual(
        printC(declaration),
        `export type FooC = t.TypeC<{
  foo: t.StringC
}>`,
      );
    });

    it('should handle the isReadonly argument', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([gen.property('foo', gen.stringType)], 'FooC'),
        true,
        true,
      );
      assert.strictEqual(
        printC(declaration),
        `export type FooC = t.ReadonlyC<t.TypeC<{
  foo: t.StringC
}>>`,
      );
    });

    it('should handle the description argument', () => {
      const declaration = gen.typeDeclaration(
        'Foo',
        gen.typeCombinator([gen.property('foo', gen.stringType)], 'FooC'),
        true,
        true,
        'bar',
      );
      assert.strictEqual(
        printC(declaration),
        `/** bar */
export type FooC = t.ReadonlyC<t.TypeC<{
  foo: t.StringC
}>>`,
      );
    });
  });

  it('partialCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.partialCombinator([
        gen.property('foo', gen.stringType),
        gen.property('bar', gen.numberType, true),
      ]),
    );
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.PartialC<{
  foo: t.StringC,
  bar: t.NumberC
}>`,
    );
  });

  it('recordCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.recordCombinator(gen.stringType, gen.numberType),
    );
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.RecordC<t.StringC, t.NumberC>`,
    );
  });

  it('arrayCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.typeCombinator(
        [gen.property('foo', gen.arrayCombinator(gen.stringType))],
        'FooC',
      ),
      true,
      false,
    );
    assert.strictEqual(
      printC(declaration),
      `export type FooC = t.TypeC<{
  foo: t.ArrayC<t.StringC>
}>`,
    );
  });

  it('readonlyArrayCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.typeCombinator(
        [gen.property('foo', gen.readonlyArrayCombinator(gen.stringType))],
        'FooC',
      ),
      true,
      false,
    );
    assert.strictEqual(
      printC(declaration),
      `export type FooC = t.TypeC<{
  foo: t.ReadonlyArrayC<t.StringC>
}>`,
    );
  });

  it('StringType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.stringType);
    assert.strictEqual(printC(declaration), `type FooC = t.StringC`);
  });

  it('NumberType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.numberType);
    assert.strictEqual(printC(declaration), `type FooC = t.NumberC`);
  });

  it('BooleanType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.booleanType);
    assert.strictEqual(printC(declaration), `type FooC = t.BooleanC`);
  });

  it('NullType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.nullType);
    assert.strictEqual(printC(declaration), `type FooC = t.NullC`);
  });

  it('UndefinedType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.undefinedType);
    assert.strictEqual(printC(declaration), `type FooC = t.UndefinedC`);
  });

  it('IntegerType', () => {
    // eslint-disable-next-line deprecation/deprecation
    const declaration = gen.typeDeclaration('Foo', gen.integerType);
    assert.strictEqual(printC(declaration), `type FooC = t.NumberC`);
  });

  it('UnknownArrayType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.unknownArrayType);
    assert.strictEqual(printC(declaration), `type FooC = t.UnknownArrayC`);
  });

  it('UnknownRecordType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.unknownRecordType);
    assert.strictEqual(printC(declaration), `type FooC = t.UnknownRecordC`);
  });

  it('FunctionType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.functionType);
    assert.strictEqual(printC(declaration), `type FooC = t.FunctionC`);
  });

  it('exactCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.exactCombinator(
        gen.typeCombinator([
          gen.property('foo', gen.stringType),
          gen.property('bar', gen.numberType),
        ]),
      ),
    );
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.TypeC<{
  foo: t.StringC,
  bar: t.NumberC
}>`,
    );
  });

  it('UnknownType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.unknownType);
    assert.strictEqual(printC(declaration), `type FooC = t.UnknownC`);
  });

  it('strictCombinator', () => {
    const declaration = gen.typeDeclaration(
      'Foo',
      gen.strictCombinator([
        gen.property('foo', gen.stringType),
        gen.property('bar', gen.numberType),
      ]),
    );
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.TypeC<{
  foo: t.StringC,
  bar: t.NumberC
}>`,
    );
  });

  it('readonlyCombinator', () => {
    const D1 = gen.typeDeclaration(
      'Foo',
      gen.readonlyCombinator(
        gen.typeCombinator([
          gen.property('foo', gen.stringType),
          gen.property('bar', gen.numberType),
        ]),
      ),
    );
    assert.strictEqual(
      printC(D1),
      `type FooC = t.ReadonlyC<t.TypeC<{
  foo: t.StringC,
  bar: t.NumberC
}>>`,
    );
  });

  it('IntType', () => {
    const declaration = gen.typeDeclaration('Foo', gen.intType);
    assert.strictEqual(
      printC(declaration),
      `type FooC = t.BrandC<t.NumberC, t.IntBrand>`,
    );
  });

  it('brandCombinator', () => {
    const D1 = gen.typeDeclaration(
      'Foo',
      gen.brandCombinator(gen.numberType, (x) => `${x} >= 0`, 'Positive'),
    );
    assert.strictEqual(printC(D1), `type FooC = t.BrandC<t.NumberC, PositiveBrand>`);
  });

  it('customCombinator', () => {
    const optionCombinator = (type: gen.TypeReference): gen.CustomCombinator =>
      gen.customCombinator(
        `Option<${gen.printStatic(type)}>`,
        `createOptionFromNullable(${gen.printRuntime(type)})`,
        gen.getNodeDependencies(type),
      );
    const declaration1 = gen.typeDeclaration('Foo', optionCombinator(gen.stringType));
    assert.strictEqual(printC(declaration1), `// exists type FooC extends t.AnyC`);
    const declaration2 = gen.customCombinator(`string`, `t.string`);
    assert.strictEqual(printC(declaration2), `typeof t.string`);
  });
});
