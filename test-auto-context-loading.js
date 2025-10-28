/**
 * Test Auto-Context Loading for CanExport Claims Agent
 *
 * This test verifies that mentioning a client name triggers automatic
 * HubSpot search and context loading.
 */

import { randomUUID } from 'crypto';

const RAILWAY_URL = 'https://grant-card-assistant-production.up.railway.app';

async function testAutoContextLoading() {
    console.log('🧪 Testing Auto-Context Loading for CanExport Claims Agent\n');

    // Test 1: Trigger with explicit client mention
    console.log('📋 Test 1: Trigger phrase "Let\'s prepare Claim 2 for Haven"');
    console.log('Expected: Auto-load Haven project context from HubSpot\n');

    try {
        const response = await fetch(`${RAILWAY_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                agentType: 'canexport-claims',
                message: "Let's prepare Claim 2 for Haven"
                // conversationId omitted - server will create new conversation
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        console.log('✅ Request sent successfully');
        console.log('📡 Streaming response...\n');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let chunkCount = 0;
        let eventCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunkCount++;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    eventCount++;
                    const data = line.slice(6);

                    if (data === '[DONE]') {
                        console.log('\n[Stream complete]');
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        // Capture content from different event types
                        if (parsed.type === 'text_delta' && parsed.text) {
                            fullResponse += parsed.text;
                            process.stdout.write(parsed.text);
                        } else if (parsed.type === 'content_delta' && parsed.content) {
                            fullResponse += parsed.content;
                            process.stdout.write(parsed.content);
                        } else if (parsed.content && !parsed.type) {
                            // Legacy format
                            fullResponse += parsed.content;
                            process.stdout.write(parsed.content);
                        }

                        if (parsed.error) {
                            console.error('\n❌ Error in stream:', parsed.error);
                        }
                    } catch (e) {
                        // Ignore parse errors for large payloads
                    }
                }
            }
        }

        console.log(`\n\n[Stats: ${chunkCount} chunks, ${eventCount} events, ${fullResponse.length} chars]`);

        console.log('\n\n📊 Analysis:');

        // Check if response includes HubSpot context
        if (fullResponse.includes('PROJECT CONTEXT') || fullResponse.includes('Financials')) {
            console.log('✅ AUTO-CONTEXT LOADED: Response includes project context');
        } else {
            console.log('❌ AUTO-CONTEXT NOT DETECTED: No project context in response');
        }

        if (fullResponse.includes('searchGrantApplications') || fullResponse.includes('Haven')) {
            console.log('✅ CLIENT NAME DETECTED: Agent recognized "Haven"');
        } else {
            console.log('⚠️  CLIENT NAME MAY NOT BE DETECTED');
        }

        console.log('\n✨ Test completed\n');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Test 2: Verify agent loads with proper tools
async function testAgentTools() {
    console.log('📋 Test 2: Verify CanExport Claims agent has HubSpot tools');

    try {
        const response = await fetch(`${RAILWAY_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                agentType: 'canexport-claims',
                message: "What tools do you have access to?"
                // conversationId omitted - server will create new conversation
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.content) {
                            fullResponse += parsed.content;
                        }
                    } catch (e) {
                        // Ignore
                    }
                }
            }
        }

        console.log('\n📊 Tool Detection:');

        if (fullResponse.includes('searchGrantApplications') || fullResponse.includes('search') && fullResponse.includes('HubSpot')) {
            console.log('✅ searchGrantApplications tool detected');
        } else {
            console.log('⚠️  searchGrantApplications tool may not be available');
        }

        if (fullResponse.includes('getGrantApplication')) {
            console.log('✅ getGrantApplication tool detected');
        } else {
            console.log('⚠️  getGrantApplication tool may not be available');
        }

        console.log('\n✨ Tool verification completed\n');

    } catch (error) {
        console.error('❌ Tool test failed:', error.message);
    }
}

// Run tests
(async () => {
    await testAutoContextLoading();
    await testAgentTools();
})();
