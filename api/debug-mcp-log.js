// Debug endpoint to retrieve MCP server log file
// GET /api/debug-mcp-log

const fs = require('fs');

module.exports = async (req, res) => {
  const logPath = '/tmp/mcp-server-debug.log';

  try {
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, 'utf-8');

      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(logContent);
    } else {
      res.status(404).send('MCP log file not found at /tmp/mcp-server-debug.log');
    }
  } catch (error) {
    res.status(500).send(`Error reading MCP log: ${error.message}`);
  }
};
