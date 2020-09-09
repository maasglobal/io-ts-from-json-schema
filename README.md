# io-ts-from-json-schema

Iotsfjs is a static code generation utility used for converting [json schema](https://json-schema.org/) files into static [TypeScript](https://www.typescriptlang.org/) types and [io-ts](https://github.com/gcanti/io-ts) runtime validators.

## Basic Use

```Shell
npm install -g io-ts-from-json-schema typescript
iotsfjs --inputFile schema.json --outputDir output
```

## Usage Example

```Shell
# Create a Project
mkdir example && cd example
npm init -f && npm install --peer fp-ts io-ts io-ts-types

# Create a Schema File
npm install --peer maas-schemas-ts
mkdir -p ./schemas/examples && echo '{
  "$id": "http://example.com/iotsfjs/examples/user.json",
  "description": "Example user schema with an external dependency",
  "type": "object",
  "definitions": {
    "name": {
      "description": "Human-readable name of the user",
      "type": "string"
    }
  },
  "properties": {
    "name": {
      "$ref": "#/definitions/name"
    },
    "phone": {
      "$ref": "http://maasglobal.com/core/components/common.json#/definitions/phone"
    }
  },
  "required": ["name", "phone"],
  "additionalProperties": false,
  "examples": [
    {
      "name": "Joe User",
      "phone": "+358407654321"
    }
  ]
}' > ./schemas/examples/user.json

# Generate TypeScript Code
npm install --dev io-ts-from-json-schema typescript
./node_modules/.bin/iotsfjs --inputFile 'schemas/**/*.json' --outputDir src --base http://example.com/iotsfjs/ --import http://maasglobal.com/^maas-schemas-ts/lib/

# Generate Tests
npm install --dev jest @types/jest doctest-ts ts-jest io-ts-validator maas-schemas-ts fp-ts io-ts io-ts-types
./node_modules/.bin/ts-jest config:init
./node_modules/.bin/doctest-ts --jest `find src -name '*.ts'`

# Run Tests
./node_modules/.bin/jest --testPathPattern --testMatch **/*.doctest.ts --roots src/

# Compile TypeScript Code
./node_modules/.bin/tsc -d --rootDir src src/examples/user.ts --outDir lib/
```
