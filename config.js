// Frontend API Configuration for Grant Card Assistant
// This file determines which backend to use based on environment

const CONFIG = {
  // Railway deployment (Agent SDK)
  RAILWAY_API: 'https://grant-card-assistant-production.up.railway.app',

  // Vercel deployment (Original API)
  VERCEL_API: window.location.hostname === 'localhost' ? 'http://localhost:3001' : '',

  // Feature flags
  USE_AGENT_SDK: true, // Set to true to use Railway Agent SDK, false for Vercel original API

  // Get the appropriate API base URL
  getApiBase() {
    if (this.USE_AGENT_SDK) {
      return this.RAILWAY_API;
    }
    return this.VERCEL_API;
  },

  // Get the appropriate endpoint for agent communication
  getAgentEndpoint() {
    if (this.USE_AGENT_SDK) {
      return `${this.RAILWAY_API}/api/agent`; // Agent SDK endpoint
    }
    return `${this.VERCEL_API}/api/process-grant/stream`; // Original endpoint
  },

  // Agent type mapping (frontend names to backend agent types)
  AGENT_TYPES: {
    'grant-cards': 'grant-card-generator',
    'etg': 'etg-writer',
    'bcafe': 'bcafe-writer',
    'canexport-claims': 'canexport-claims',
  },

  // Get backend agent type from frontend route
  getAgentType(frontendType) {
    return this.AGENT_TYPES[frontendType] || frontendType;
  }
};

// Make config available globally
window.GRANT_CARD_CONFIG = CONFIG;

console.log('✅ API Config loaded:', {
  mode: CONFIG.USE_AGENT_SDK ? 'Agent SDK (Railway)' : 'Original API (Vercel)',
  endpoint: CONFIG.getAgentEndpoint()
});
