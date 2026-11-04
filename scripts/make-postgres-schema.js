// Generates the production Postgres Prisma schema from prisma/schema.prisma.
// The source of truth stays SQLite for local dev; Render uses this generated file.
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const target = path.join(__dirname, '..', 'prisma', 'schema.postgres.prisma');

const schema = fs.readFileSync(source, 'utf8').replace(
  /\ndatasource db \{[\s\S]*?\n\}/,
  '\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}'
);

if (!schema.includes('provider = "postgresql"')) {
  throw new Error('Could not rewrite the datasource block in prisma/schema.prisma');
}

fs.writeFileSync(target, schema);
console.log(`Generated ${target}`);
