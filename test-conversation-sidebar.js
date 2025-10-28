/**
 * Test script to verify conversation sidebar functionality
 * Run this in browser console to debug the issue
 */

console.log('🔍 Testing Conversation Sidebar Functionality');
console.log('='.repeat(80));

// Check if key elements exist
const elements = {
  'Conversation List': document.getElementById('conversation-list'),
  'User Avatar': document.getElementById('user-avatar'),
  'User Name Display': document.getElementById('user-name-display'),
  'Sidebar': document.getElementById('sidebar'),
  'Sidebar Overlay': document.getElementById('sidebar-overlay')
};

console.log('\n📋 Element Check:');
Object.entries(elements).forEach(([name, el]) => {
  console.log(`  ${el ? '✅' : '❌'} ${name}: ${el ? 'Found' : 'NOT FOUND'}`);
});

// Check if key functions exist
const functions = {
  'loadConversationsList': typeof loadConversationsList,
  'toggleSidebar': typeof toggleSidebar,
  'switchConversation': typeof switchConversation,
  'getUserInfo': typeof getUserInfo,
  'updateUserProfile': typeof updateUserProfile,
  'renderConversationsList': typeof renderConversationsList
};

console.log('\n🔧 Function Check:');
Object.entries(functions).forEach(([name, type]) => {
  console.log(`  ${type === 'function' ? '✅' : '❌'} ${name}: ${type}`);
});

// Test getUserInfo
console.log('\n👤 User Info Test:');
try {
  const userInfo = getUserInfo();
  if (userInfo) {
    console.log('  ✅ User info loaded:', userInfo);
  } else {
    console.log('  ❌ User info is null (check authentication)');
  }
} catch (error) {
  console.log('  ❌ Error getting user info:', error.message);
}

// Test API_BASE
console.log('\n🌐 API Configuration:');
console.log(`  API_BASE: ${typeof API_BASE !== 'undefined' ? API_BASE : 'NOT DEFINED'}`);
console.log(`  Hostname: ${window.location.hostname}`);
console.log(`  Full URL: ${window.location.href}`);

// Test conversation API call
console.log('\n📡 Testing Conversation API:');
const agentType = window.location.pathname.split('/')[1];
console.log(`  Detected agentType: ${agentType}`);

if (typeof API_BASE !== 'undefined') {
  fetch(`${API_BASE}/api/conversations?agentType=${agentType}`, {
    credentials: 'include'
  })
    .then(response => {
      console.log(`  Response status: ${response.status}`);
      return response.json();
    })
    .then(data => {
      console.log(`  ✅ Conversations loaded:`, data);
    })
    .catch(error => {
      console.log(`  ❌ Error loading conversations:`, error.message);
    });
} else {
  console.log('  ❌ API_BASE not defined, cannot test API');
}

console.log('\n' + '='.repeat(80));
