const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

async function initDatabase() {
  try {
    console.log('Initializing database...');

    // Read schema file
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema
    console.log(schema);
    await pool.query(schema);

    console.log('✓ Database schema created successfully');
    console.log('✓ All tables and indexes created');
    
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initDatabase();