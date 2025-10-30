/**
 * Test Email Context Integration
 *
 * Tests if the agent proactively loads email history when asked for
 * project context, and uses it intelligently rather than just displaying stats.
 */

import { randomUUID } from 'crypto';

const RAILWAY_URL = 'https://grant-card-assistant-production.up.railway.app';

async function testEmailContextIntegration() {
    console.log('🧪 Testing Email Context Integration for CanExport Claims Agent\n');

    console.log('📋 Test: Natural prompt asking for project context');
    console.log('Prompt: "We need to prepare Claim 2 for Haven. What else should I know about this project?"');
    console.log('Expected: Agent proactively loads email history and uses it to enrich response\n');

    try {
        const response = await fetch(`${RAILWAY_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                agentType: 'canexport-claims',
                message: "We need to prepare Claim 2 for Haven. What else should I know about this project?"
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        console.log('✅ Request sent successfully');
        console.log('📡 Streaming response...\n');
        console.log('─'.repeat(80));

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let toolsUsed = [];

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

                        // Track tool usage
                        if (parsed.type === 'tool_use' && parsed.name) {
                            toolsUsed.push(parsed.name);
                        }

                        // Capture text content
                        if (parsed.type === 'text_delta' && parsed.text) {
                            fullResponse += parsed.text;
                            process.stdout.write(parsed.text);
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        }

        console.log('\n' + '─'.repeat(80));
        console.log('\n📊 Analysis:\n');

        // Check which tools were used
        console.log('🔧 Tools Used:');
        if (toolsUsed.length > 0) {
            toolsUsed.forEach(tool => console.log(`   - ${tool}`));
        } else {
            console.log('   (No tools detected in stream)');
        }
        console.log('');

        // Analyze response quality
        const checks = {
            projectContextLoaded: fullResponse.includes('Haven') || fullResponse.includes('PROJECT CONTEXT'),
            emailToolsUsed: toolsUsed.some(t => t.includes('email') || t === 'get_project_email_history' || t === 'search_project_emails'),
            intelligentContext: !fullResponse.includes('Total Emails:') && !fullResponse.includes('Email Communication Summary:'),
            specificReferences: fullResponse.includes('email') && !fullResponse.includes('📧 Email Communication Summary')
        };

        console.log('✅ Quality Checks:');
        console.log(`   ${checks.projectContextLoaded ? '✅' : '❌'} Project context loaded (Haven identified)`);
        console.log(`   ${checks.emailToolsUsed ? '✅' : '⚠️'} Email tools used proactively`);
        console.log(`   ${checks.intelligentContext ? '✅' : '⚠️'} Email context used intelligently (no raw stats dump)`);
        console.log(`   ${checks.specificReferences ? '✅' : '⚠️'} Specific email references in response`);
        console.log('');

        // Overall assessment
        const allPassed = Object.values(checks).every(v => v === true);

        if (allPassed) {
            console.log('🎉 SUCCESS: Agent proactively loaded and intelligently used email context!');
        } else if (checks.emailToolsUsed && checks.intelligentContext) {
            console.log('✅ PARTIAL SUCCESS: Agent used email tools but may need prompt refinement');
        } else if (!checks.emailToolsUsed) {
            console.log('⚠️  NEEDS IMPROVEMENT: Agent did not proactively load email history');
            console.log('    → May need to update agent prompt to emphasize email context loading');
        } else {
            console.log('⚠️  NEEDS REFINEMENT: Agent loaded emails but displayed raw stats instead of insights');
            console.log('    → May need to refine prompt to use emails as background context');
        }

        console.log('\n✨ Test completed\n');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run test
testEmailContextIntegration();
