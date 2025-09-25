// Create this file: api/test-db.js
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    // Test basic connection
    const timeResult = await sql`SELECT NOW() as current_time`;
    
    // Check if our tables exist
    const tableCheck = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'conversations', 'messages');
    `;
    
    const existingTables = tableCheck.rows.map(row => row.table_name);
    const needsTables = existingTables.length === 0;
    
    // If no tables exist, create them
    if (needsTables) {
      // Create users table
      await sql`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          google_id VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          picture VARCHAR(500),
          created_at TIMESTAMP DEFAULT NOW(),
          last_login TIMESTAMP DEFAULT NOW()
        );
      `;
      
      // Create conversations table  
      await sql`
        CREATE TABLE conversations (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          workflow_type VARCHAR(100) NOT NULL DEFAULT 'grant-cards',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `;
      
      // Create messages table
      await sql`
        CREATE TABLE messages (
          id SERIAL PRIMARY KEY,
          conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          file_attachments JSON DEFAULT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `;
      
      // Create indexes
      await sql`CREATE INDEX idx_users_google_id ON users(google_id);`;
      await sql`CREATE INDEX idx_conversations_user_id ON conversations(user_id);`;
      await sql`CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);`;
    }
    
    // Final table check
    const finalCheck = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'conversations', 'messages')
      ORDER BY table_name;
    `;
    
    res.json({
      status: 'success',
      database_connected: true,
      current_time: timeResult.rows[0].current_time,
      tables_created: finalCheck.rows.map(row => row.table_name),
      tables_needed: ['conversations', 'messages', 'users'],
      setup_complete: finalCheck.rows.length === 3,
      created_tables_now: needsTables
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database_connected: false,
      error_message: error.message,
      hint: 'Check your POSTGRES_URL environment variable'
    });
  }
}
