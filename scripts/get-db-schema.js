import pkg from 'pg';
const { Client } = pkg;

async function getSchema() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    // Get all tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('# Database Schema\n');

    // For each table, get columns
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      console.log(`## ${tableName}\n`);

      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      console.log('| Column Name | Data Type | Nullable | Default |');
      console.log('|-------------|-----------|----------|---------|');

      for (const col of columnsResult.rows) {
        const colName = col.column_name;
        const dataType = col.data_type;
        const nullable = col.is_nullable;
        const defaultVal = col.column_default || '';
        console.log(`| ${colName} | ${dataType} | ${nullable} | ${defaultVal} |`);
      }

      console.log('');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

getSchema();
