const fs = require('fs').promises;
const path = require('path');
const pool = require('../db/pool');

const initDatabase = async () => {
  try {
    console.log('Initializing database...');

    // Read schema file asynchronously
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');

    // Execute schema
    await pool.query(schema);

    console.log('✓ Database schema created successfully');
    console.log('✓ All tables and indexes created');
    
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
};

initDatabase();